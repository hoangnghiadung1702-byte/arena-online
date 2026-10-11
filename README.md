# FPS Online — prototype multiplayer

A small browser-based 3D first-person shooter prototype. It uses Three.js for rendering and Socket.IO for real-time room membership and player updates.

## Features

- Create a room and get a 5-character room ID.
- Join that room from another browser/device over the Internet.
- Real-time player movement, simple 3D arena, hit points and score.
- Supports desktop keyboard/mouse and basic touch controls.
- Maximum 8 players per room.

## Run locally

You need Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000 in a browser. Open another browser window to test a second player.

To test from a phone on the same Wi-Fi, open `http://YOUR_COMPUTER_LAN_IP:3000` on the phone. Your firewall may need to allow port 3000.

## Deploy for friends over the Internet (free tier)

One simple option is Render's free web service tier. Free-tier policies can change; instances may sleep when idle and wake-up can take a little while.

1. Create a GitHub account if you don't already have one.
2. Create a new GitHub repository and upload the files in this project (keep `server.js`, `package.json`, `README.md`, and the `public` folder at the repository root).
3. In Render, choose **New + → Web Service**, connect that repository.
4. Use these settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free (if available for your account/region)
5. Deploy. Render will provide a public URL like `https://your-service-name.onrender.com`.
6. Open that URL. Create a room and send the room ID to friends. They all open the same URL and enter the ID.

The server listens on `process.env.PORT`, which is required by common hosting platforms. Socket.IO uses WebSocket when available and falls back to HTTP long-polling.

## Important prototype limitations

- The prototype is intended for learning and casual testing, not competitive/public production use.
- For speed of prototyping, the client reports which target it hit. A real competitive game must validate hits server-side with authoritative movement, server-side ray casting, fire-rate limits, and stronger anti-cheat.
- No login, persistent accounts, matchmaking, voice chat, or saved statistics.
- Rooms are kept in memory. Restarting/redeploying the server ends active rooms.
- Third-party Three.js module is loaded from jsDelivr, so clients need Internet access.
- For touch devices, controls are basic virtual pads; desktop is the most polished experience.
- Use HTTPS hosting for browser pointer-lock and production security.
