package com.bydrus.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;

import javax.crypto.Cipher;

/**
 * Минимальный ADB-клиент: приложение подключается к ADB самого головного устройства
 * (127.0.0.1:5555) и выдаёт себе нужные права, чтобы не понадобился компьютер.
 * Работает, только если на автомобиле включена отладка по сети.
 */
final class AdbClient implements Closeable {

    interface Say {
        void say(String message);
    }

    private static final int A_CNXN = 0x4e584e43;
    private static final int A_AUTH = 0x48545541;
    private static final int A_OPEN = 0x4e45504f;
    private static final int A_OKAY = 0x59414b4f;
    private static final int A_CLSE = 0x45534c43;
    private static final int A_WRTE = 0x45545257;

    private static final int AUTH_TOKEN = 1;
    private static final int AUTH_SIGNATURE = 2;
    private static final int AUTH_RSAPUBLICKEY = 3;

    private static final int VERSION = 0x01000000;
    private static final int MAX_DATA = 4096;

    /** Префикс DigestInfo для SHA-1 (ADB подписывает токен как готовый хеш). */
    private static final byte[] SHA1_PREFIX = {
            0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14};

    private final Context ctx;
    private Socket socket;
    private DataInputStream in;
    private OutputStream out;
    private int nextLocalId = 1;
    private PrivateKey privateKey;
    private RSAPublicKey publicKey;

    AdbClient(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    private static final class Msg {
        int cmd, arg0, arg1;
        byte[] data;
    }

    void connect(String host, int port, Say say) throws Exception {
        loadOrCreateKey();
        socket = new Socket();
        socket.connect(new InetSocketAddress(host, port), 2500);
        socket.setTcpNoDelay(true);
        socket.setSoTimeout(8000);
        in = new DataInputStream(socket.getInputStream());
        out = socket.getOutputStream();

        send(A_CNXN, VERSION, MAX_DATA, "host::\0".getBytes(StandardCharsets.UTF_8));
        boolean signatureSent = false;
        boolean keySent = false;
        while (true) {
            Msg m = read();
            if (m.cmd == A_CNXN) return;
            if (m.cmd != A_AUTH || m.arg0 != AUTH_TOKEN) {
                throw new IOException("неожиданный ответ ADB (0x" + Integer.toHexString(m.cmd) + ")");
            }
            if (!signatureSent) {
                signatureSent = true;
                send(A_AUTH, AUTH_SIGNATURE, 0, sign(m.data));
            } else if (!keySent) {
                keySent = true;
                if (say != null) {
                    say.say("На экране должен появиться запрос «Разрешить отладку?» — "
                            + "отметьте «Всегда разрешать» и нажмите «Разрешить» (жду 60 секунд).");
                }
                socket.setSoTimeout(60000);
                send(A_AUTH, AUTH_RSAPUBLICKEY, 0, encodePublicKey(publicKey));
            } else {
                throw new IOException("автомобиль не принял ключ отладки");
            }
        }
    }

    /** Выполняет команду в оболочке ADB и возвращает её вывод. */
    String shell(String command) throws IOException {
        if (socket == null) throw new IOException("нет соединения");
        socket.setSoTimeout(20000);
        int local = nextLocalId++;
        send(A_OPEN, local, 0, ("shell:" + command + "\0").getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        int remote = 0;
        while (true) {
            Msg m = read();
            if (m.arg1 != local && m.cmd != A_CLSE) continue;
            if (m.cmd == A_OKAY) {
                remote = m.arg0;
            } else if (m.cmd == A_WRTE) {
                remote = m.arg0;
                result.write(m.data, 0, m.data.length);
                send(A_OKAY, local, remote, new byte[0]);
            } else if (m.cmd == A_CLSE) {
                if (m.arg1 == local || m.arg1 == 0) {
                    if (remote != 0) send(A_CLSE, local, remote, new byte[0]);
                    break;
                }
            }
        }
        return new String(result.toByteArray(), StandardCharsets.UTF_8).trim();
    }

    @Override
    public void close() {
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        socket = null;
    }

    // ---------------------------------------------------------------- протокол

    private void send(int cmd, int arg0, int arg1, byte[] data) throws IOException {
        int sum = 0;
        for (byte b : data) sum += (b & 0xff);
        ByteBuffer bb = ByteBuffer.allocate(24 + data.length).order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(cmd).putInt(arg0).putInt(arg1).putInt(data.length).putInt(sum).putInt(~cmd);
        bb.put(data);
        out.write(bb.array());
        out.flush();
    }

    private Msg read() throws IOException {
        byte[] head = new byte[24];
        in.readFully(head);
        ByteBuffer bb = ByteBuffer.wrap(head).order(ByteOrder.LITTLE_ENDIAN);
        Msg m = new Msg();
        m.cmd = bb.getInt();
        m.arg0 = bb.getInt();
        m.arg1 = bb.getInt();
        int len = bb.getInt();
        if (len < 0 || len > (1 << 20)) throw new IOException("повреждённый пакет ADB");
        m.data = new byte[len];
        in.readFully(m.data);
        return m;
    }

    // ------------------------------------------------------------------- ключи

    private void loadOrCreateKey() throws Exception {
        SharedPreferences p = Prefs.sp(ctx);
        String priv = p.getString(Prefs.ADB_PRIV, null);
        String pub = p.getString(Prefs.ADB_PUB, null);
        KeyFactory kf = KeyFactory.getInstance("RSA");
        if (priv != null && pub != null) {
            try {
                privateKey = kf.generatePrivate(new PKCS8EncodedKeySpec(Base64.decode(priv, Base64.NO_WRAP)));
                publicKey = (RSAPublicKey) kf.generatePublic(
                        new X509EncodedKeySpec(Base64.decode(pub, Base64.NO_WRAP)));
                return;
            } catch (Exception ignored) {
            }
        }
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        KeyPair pair = gen.generateKeyPair();
        privateKey = pair.getPrivate();
        publicKey = (RSAPublicKey) pair.getPublic();
        p.edit()
                .putString(Prefs.ADB_PRIV, Base64.encodeToString(privateKey.getEncoded(), Base64.NO_WRAP))
                .putString(Prefs.ADB_PUB, Base64.encodeToString(publicKey.getEncoded(), Base64.NO_WRAP))
                .apply();
    }

    private byte[] sign(byte[] token) throws Exception {
        Cipher c = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        c.init(Cipher.ENCRYPT_MODE, privateKey);
        c.update(SHA1_PREFIX);
        return c.doFinal(token);
    }

    /** Открытый ключ в формате Android (структура RSAPublicKey из libmincrypt) + base64. */
    static byte[] encodePublicKey(RSAPublicKey key) {
        BigInteger n = key.getModulus();
        BigInteger r32 = BigInteger.ZERO.setBit(32);
        BigInteger rr = BigInteger.ZERO.setBit(2048).modPow(BigInteger.valueOf(2), n);
        BigInteger n0inv = n.remainder(r32).modInverse(r32).negate();

        ByteBuffer bb = ByteBuffer.allocate(4 + 4 + 256 + 256 + 4).order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(64);
        bb.putInt(n0inv.intValue());
        BigInteger t = n;
        for (int i = 0; i < 64; i++) {
            bb.putInt(t.intValue());
            t = t.shiftRight(32);
        }
        t = rr;
        for (int i = 0; i < 64; i++) {
            bb.putInt(t.intValue());
            t = t.shiftRight(32);
        }
        bb.putInt(key.getPublicExponent().intValue());
        String text = Base64.encodeToString(bb.array(), Base64.NO_WRAP) + " bydrus@car\0";
        return text.getBytes(StandardCharsets.UTF_8);
    }
}
