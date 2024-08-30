const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');
const path = require('path');

// Create Express app and HTTP server
const app = express();
const wss = new WebSocket.Server({ server });

// Data sesi pengguna
let userLikes = {}; // Menyimpan jumlah likes per pengguna
let userGifts = {}; // Menyimpan jumlah gifts per pengguna
let userShares = {}; // Menyimpan jumlah shares per pengguna
let userProfiles = {}; // Menyimpan data profil pengguna

// Array gambar yang akan ditampilkan untuk like
const profilePictures = [
    'public/images/image1.jpg', // Gambar untuk 1 like
    'public/images/image2.jpg', // Gambar untuk 2 likes
    'public/images/image3.jpg', // Gambar untuk 3 likes
    // Tambahkan lebih banyak gambar sesuai kebutuhan
];

// Fungsi untuk mengupdate jumlah likes per pengguna
function updateUserLikes(username, likeCount) {
    userLikes[username] = (userLikes[username] || 0) + likeCount;

    // Tentukan gambar yang akan ditampilkan berdasarkan jumlah like
    let pictureIndex = Math.min(userLikes[username] - 1, profilePictures.length - 1);
    const profilePictureUrl = profilePictures[pictureIndex];

    // Kirimkan update gambar profil dan jumlah like ke klien
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'updateProfilePicture',
                username: username,
                pictureUrl: profilePictureUrl,
                likes: userLikes[username],
                gifts: userGifts[username] || 0,
                shares: userShares[username] || 0
            }));
        }
    });
}

// Fungsi untuk memperbarui tampilan foto profil pengguna
function updateProfilePicture(username) {
    const profileInfo = {
        username: username,
        likes: userLikes[username] || 0,
        gifts: userGifts[username] || 0,
        shares: userShares[username] || 0
    };

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'updateProfilePicture',
                ...profileInfo
            }));
        }
    });
}

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Variable to hold TikTok username
let tiktokLiveConnection;

// Function to play sound on client
function playSound(ws, soundPath) {
    ws.send(JSON.stringify({
        type: 'play-sound',
        sound: soundPath
    }));
}

// Function to display floating photo
function displayFloatingPhoto(ws, profilePictureUrl, userName) {
    ws.send(JSON.stringify({
        type: 'floating-photo',
        profilePictureUrl: profilePictureUrl,
        userName: userName
    }));
}

// Function to show big photo
function showBigPhoto(ws, profilePictureUrl, userName) {
    ws.send(JSON.stringify({
        type: 'big-photo',
        profilePictureUrl: profilePictureUrl,
        userName: userName
    }));
}

// Function to handle member join
function handleMemberJoin(ws, data) {
    console.log(`${data.uniqueId} joined the stream!`);
    displayFloatingPhoto(ws, data.profilePictureUrl, data.uniqueId);
    playSound(ws, 'sounds/hallo.mp3');
}

// Function to handle gift
function handleGift(ws, data) {
    if (data.giftType === 1 && !data.repeatEnd) {
        // Streak in progress => show only temporary
        console.log(`${data.uniqueId} is sending gift ${data.giftName} x${data.repeatCount}`);
    } else {
        // Streak ended or non-streakable gift => process the gift with final repeat_count
        console.log(`${data.uniqueId} has sent gift ${data.giftName} x${data.repeatCount}`);
        showBigPhoto(ws, data.profilePictureUrl, data.uniqueId);
        playSound(ws, 'sounds/winner.mp3');
    }
}

// Function to handle like
function handleLike(ws, data) {
    console.log(`${data.uniqueId} sent ${data.likeCount} likes`);
    for (let i = 0; i < data.likeCount; i++) {
        setTimeout(() => {
            displayFloatingPhoto(ws, data.profilePictureUrl, data.uniqueId);
        }, i * 1000); // Delay each like
    }
}

// Function to handle share
function handleShare(ws, data) {
    console.log(`${data.uniqueId} shared the stream!`);
    displayFloatingPhoto(ws, data.profilePictureUrl, data.uniqueId);
    playSound(ws, 'sounds/kentut.mp3');
}

// Function to handle envelope
function handleEnvelope(ws, data) {
    console.log('Envelope received:', data);
    playSound(ws, 'sounds/anjay.mp3');
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('WebSocket connection established.');

    // Handle incoming messages from clients
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'connect') {
            const username = data.username;
            console.log('Connecting to TikTok with username:', username);

            // If there's an existing connection, disconnect it
            if (tiktokLiveConnection) {
                tiktokLiveConnection.disconnect();
            }

            // Create a new WebcastPushConnection object with the new username
            tiktokLiveConnection = new WebcastPushConnection(username);

            tiktokLiveConnection.connect().then(state => {
                console.info(`Connected to roomId ${state.roomId}`);
            }).catch(err => {
                console.error('Failed to connect', err);
            });

            tiktokLiveConnection.on('connected', (state) => {
                console.log('Hurray! Connected!', state);
            });

            tiktokLiveConnection.on('disconnected', () => {
                console.log('Disconnected :(');
            });

            tiktokLiveConnection.on('streamEnd', (actionId) => {
                console.log('Stream ended with actionId:', actionId);
                // Handle stream end event
            });

            tiktokLiveConnection.on('member', (data) => handleMemberJoin(ws, data));

            tiktokLiveConnection.on('gift', (data) => handleGift(ws, data));

            tiktokLiveConnection.on('like', (data) => handleLike(ws, data));

            tiktokLiveConnection.on('share', (data) => handleShare(ws, data));

            tiktokLiveConnection.on('envelope', (data) => handleEnvelope(ws, data));

            tiktokLiveConnection.on('chat', (data) => {
                console.log(`${data.uniqueId} (userId:${data.userId}) writes: ${data.comment}`);
                ws.send(JSON.stringify({
                    type: 'chat',
                    userName: data.uniqueId,
                    comment: data.comment
                }));
            });

            tiktokLiveConnection.on('websocketConnected', (websocketClient) => {
                console.log("Websocket:", websocketClient.connection);
            });

            tiktokLiveConnection.on('roomUser', (data) => {
                console.log(`Viewer Count: ${data.viewerCount}`);
                ws.send(JSON.stringify({
                    type: 'roomUser',
                    viewerCount: data.viewerCount
                }));
            });

            ws.on('close', () => {
                console.log('WebSocket connection closed.');
                if (tiktokLiveConnection) {
                    tiktokLiveConnection.disconnect();
                }
            });
        }
    });

    ws.send(JSON.stringify({ type: 'connected' }));
});

// Automatically find an available port and start the server
const port = 8084;
server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
