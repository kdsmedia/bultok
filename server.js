const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');
const path = require('path');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Fitur Baru: Papan Peringkat Sesi ---
let sessionStats = {}; // Menyimpan statistik (likes, gift, share) untuk papan peringkat

// --- Fitur Baru: Antrian Suara ---
let soundQueue = []; // Antrian untuk memutar suara satu per satu
let isSoundPlaying = false; // Status untuk memeriksa apakah ada suara yang sedang diputar
let currentSoundTimeout = null; // Menyimpan timeout suara yang sedang berjalan

// --- Fitur Baru: Tarik Tambang ---
const TUG_OF_WAR_GIFT_ID = 5655; // ID untuk gift Mawar (Rose). Anda bisa menggantinya.
let tugOfWar = {
    position: 50, // Posisi awal di tengah (0=Like menang, 100=Gift menang)
    teamLikeScore: 0,
    teamGiftScore: 0
};

// --- Fitur Baru: Gift Mahal (DIPERBARUI) ---
const EXPENSIVE_GIFT_IDS = {
    '5583': 'money_gun',        // Money Gun
    '29588': 'whale',           // Whale
    '29658': 'lion',            // Lion (Sudah ada)
    '29851': 'sports_car',      // Sports Car
    '30136': 'tiktok_universe', // TikTok Universe (Sudah ada)
    // Tambahkan ID gift mahal lainnya di sini dengan format 'giftId': 'namaEfek'
};


// =============================================================================
// FUNGSI-FUNGSI UTAMA (TELAH DIPERBARUI)
// =============================================================================

/**
 * FITUR BARU: Menambahkan suara ke antrian dan memprosesnya.
 * Menggantikan fungsi playSound() yang lama.
 * @param {string} soundPath Path ke file suara.
 */
function addToSoundQueue(soundPath) {
    soundQueue.push(soundPath);
    if (!isSoundPlaying) {
        processSoundQueue();
    }
}

/**
 * FITUR BARU: Memproses suara dari antrian satu per satu.
 */
function processSoundQueue() {
    if (isSoundPlaying || soundQueue.length === 0) {
        return; // Jangan lakukan apa-apa jika suara sedang diputar atau antrian kosong
    }

    isSoundPlaying = true;
    const soundPath = soundQueue.shift(); // Ambil suara pertama dari antrian

    // Kirim perintah putar suara ke semua klien
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'play-sound', sound: soundPath }));
        }
    });

    // Asumsi durasi suara 5 detik. Setelah selesai, proses antrian berikutnya.
    // Untuk hasil terbaik, sesuaikan durasi ini dengan panjang file audio Anda.
    currentSoundTimeout = setTimeout(() => {
        isSoundPlaying = false;
        processSoundQueue(); // Coba proses suara berikutnya di antrian
    }, 5000);
}

/**
 * DIPERBARUI: Menghentikan suara yang sedang diputar dan membersihkan antrian.
 */
function stopPlayingSound() {
    if (isSoundPlaying) {
        clearTimeout(currentSoundTimeout);
        isSoundPlaying = false;
        currentSoundTimeout = null;
    }
    soundQueue = []; // Kosongkan seluruh antrian suara

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'stop-sound' }));
        }
    });
    console.log('Pemutaran suara dihentikan dan antrian dibersihkan.');
}

// Fungsi untuk menampilkan foto melayang (tidak berubah)
function displayFloatingPhoto(profilePictureUrl, userName) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'floating-photo', profilePictureUrl, userName }));
        }
    });
}

// Fungsi untuk menampilkan foto besar (tidak berubah)
function showBigPhoto(profilePictureUrl, userName) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'big-photo', profilePictureUrl, userName }));
        }
    });
}

/**
 * FITUR BARU: Mengirim update Papan Peringkat ke semua klien.
 */
function updateAndBroadcastLeaderboard() {
    // Urutkan pengguna berdasarkan nilai gift tertinggi
    const sortedStats = Object.entries(sessionStats)
        .sort(([, a], [, b]) => b.giftValue - a.giftValue)
        .slice(0, 5) // Ambil 5 teratas
        .map(([username, stats]) => ({ username, ...stats }));

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'leaderboard-update', leaderboard: sortedStats }));
        }
    });
}

/**
 * FITUR BARU: Mengirim status game Tarik Tambang ke semua klien.
 */
function broadcastTugOfWarState() {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'tug-of-war-update', gameState: tugOfWar }));
        }
    });
}

// =============================================================================
// EVENT HANDLERS (TELAH DIPERBARUI DENGAN FITUR BARU)
// =============================================================================

function handleMemberJoin(data) {
    console.log(`${data.uniqueId} bergabung!`);
    displayFloatingPhoto(data.profilePictureUrl, data.uniqueId);
    addToSoundQueue('sounds/hallo.mp3');
}

function handleGift(data) {
    if (data.giftType === 1 && !data.repeatEnd) {
        // Streak sedang berlangsung, abaikan sementara
        return;
    }
    
    console.log(`${data.uniqueId} telah mengirim gift ${data.giftName} x${data.repeatCount}`);
    showBigPhoto(data.profilePictureUrl, data.uniqueId);
    addToSoundQueue('sounds/winner.mp3');

    const user = data.uniqueId;
    const giftValue = data.diamondCount * data.repeatCount;

    // --- LOGIKA PAPAN PERINGKAT ---
    if (!sessionStats[user]) {
        sessionStats[user] = { likes: 0, giftValue: 0, shares: 0, profilePictureUrl: data.profilePictureUrl };
    }
    sessionStats[user].giftValue += giftValue;
    sessionStats[user].profilePictureUrl = data.profilePictureUrl; // Selalu update foto profil terbaru

    // --- LOGIKA TARIK TAMBANG ---
    if (String(data.giftId) === String(TUG_OF_WAR_GIFT_ID)) {
        tugOfWar.position += 1 * data.repeatCount;
        tugOfWar.teamGiftScore += data.repeatCount;
        if (tugOfWar.position >= 100) {
            tugOfWar.position = 100;
            // Kirim event kemenangan Tim Gift dan reset
            wss.clients.forEach(c => c.send(JSON.stringify({type: 'tug-of-war-win', winner: 'gift'})));
            tugOfWar = { position: 50, teamLikeScore: 0, teamGiftScore: 0 };
        }
    }

    // --- LOGIKA GIFT MAHAL ---
    const effect = EXPENSIVE_GIFT_IDS[String(data.giftId)];
    if (effect) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'fullscreen-effect',
                    effect: effect,
                    userName: data.uniqueId,
                    profilePictureUrl: data.profilePictureUrl
                }));
            }
        });
    }
}

function handleLike(data) {
    console.log(`${data.uniqueId} mengirim ${data.likeCount} like`);
    displayFloatingPhoto(data.profilePictureUrl, data.uniqueId);

    const user = data.uniqueId;

    // --- LOGIKA PAPAN PERINGKAT ---
    if (!sessionStats[user]) {
        sessionStats[user] = { likes: 0, giftValue: 0, shares: 0, profilePictureUrl: data.profilePictureUrl };
    }
    sessionStats[user].likes += data.likeCount;
    sessionStats[user].profilePictureUrl = data.profilePictureUrl;

    // --- LOGIKA TARIK TAMBANG ---
    // Kurangi 0.05 poin per like agar lebih seimbang
    tugOfWar.position -= 0.05 * data.likeCount;
    tugOfWar.teamLikeScore += data.likeCount;
    if (tugOfWar.position <= 0) {
        tugOfWar.position = 0;
        // Kirim event kemenangan Tim Like dan reset
        wss.clients.forEach(c => c.send(JSON.stringify({type: 'tug-of-war-win', winner: 'like'})));
        tugOfWar = { position: 50, teamLikeScore: 0, teamGiftScore: 0 };
    }
}

function handleShare(data) {
    console.log(`${data.uniqueId} membagikan stream!`);
    displayFloatingPhoto(data.profilePictureUrl, data.uniqueId);
    addToSoundQueue('sounds/kentut.mp3');

    const user = data.uniqueId;

    // --- LOGIKA PAPAN PERINGKAT ---
    if (!sessionStats[user]) {
        sessionStats[user] = { likes: 0, giftValue: 0, shares: 0, profilePictureUrl: data.profilePictureUrl };
    }
    sessionStats[user].shares += 1; // Setiap share dihitung 1
    sessionStats[user].profilePictureUrl = data.profilePictureUrl;
}

function handleEnvelope(data) {
    console.log('Envelope diterima:', data);
    addToSoundQueue('sounds/anjay.mp3');
}

function handleChat(data) {
    console.log(`${data.uniqueId} menulis: ${data.comment}`);
    
    // Kirim chat ke semua klien (agar bisa ditampilkan di layar jika diinginkan)
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'chat', userName: data.uniqueId, comment: data.comment }));
        }
    });

    const soundMapping = {
        '1': 'sounds/1.mp3', '2': 'sounds/2.mp3', '3': 'sounds/3.mp3', '4': 'sounds/4.mp3', 
        '5': 'sounds/ahh.mp3', '6': 'sounds/6.mp3', '7': 'sounds/7.mp3', '8': 'sounds/8.mp3', 
        '9': 'sounds/9.mp3', '10': 'sounds/10.mp3', '11': 'sounds/11.mp3', '12': 'sounds/12.mp3', 
        '13': 'sounds/13.mp3', '14': 'sounds/14.mp3', '15': 'sounds/15.mp3', '16': 'sounds/16.mp3', 
        '17': 'sounds/17.mp3', '18': 'sounds/18.mp3', '19': 'sounds/19.mp3', '20': 'sounds/20.mp3', 
        'm': 'sounds/1.mp3', 'assalamualaikum': 'sounds/salam.mp3', 'halo': 'sounds/hallo.mp3'
    };

    const soundFile = soundMapping[data.comment.trim().toLowerCase()];
    if (soundFile) {
        addToSoundQueue(soundFile);
    }

    if (data.comment.trim().toLowerCase() === 'ganti') {
        stopPlayingSound();
    }
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

let tiktokLiveConnection;

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('Koneksi WebSocket berhasil dibuat.');

    // Kirim status awal ke pengguna yang baru terhubung
    ws.send(JSON.stringify({ type: 'tug-of-war-update', gameState: tugOfWar }));
    updateAndBroadcastLeaderboard(); // Kirim leaderboard saat pertama kali terhubung

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'connect') {
            const username = data.username;
            console.log('Menyambungkan ke TikTok dengan username:', username);

            if (tiktokLiveConnection) {
                tiktokLiveConnection.disconnect();
            }

            // Reset semua statistik saat koneksi baru dimulai
            sessionStats = {};
            tugOfWar = { position: 50, teamLikeScore: 0, teamGiftScore: 0 };
            soundQueue = [];

            tiktokLiveConnection = new WebcastPushConnection(username);

            tiktokLiveConnection.connect().then(state => {
                console.info(`Terhubung ke roomId ${state.roomId}`);
            }).catch(err => {
                console.error('Gagal terhubung', err);
            });
            
            tiktokLiveConnection.on('member', handleMemberJoin);
            tiktokLiveConnection.on('gift', handleGift);
            tiktokLiveConnection.on('like', handleLike);
            tiktokLiveConnection.on('share', handleShare);
            tiktokLiveConnection.on('envelope', handleEnvelope);
            tiktokLiveConnection.on('chat', handleChat);
        }
    });

    ws.on('close', () => {
        console.log('Koneksi WebSocket ditutup.');
    });
});

// Broadcast update secara berkala ke semua klien
setInterval(() => {
    if (tiktokLiveConnection && tiktokLiveConnection.isConnected()) {
        updateAndBroadcastLeaderboard();
        broadcastTugOfWarState();
    }
}, 5000); // Setiap 5 detik

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});
