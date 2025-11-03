const express = require('express');
const path = require('path');
const http = require('http');
const hbs = require("hbs");
const socketio = require("socket.io");
const collection = require("./src/mongodb");

const session = require("express-session");

const app = express();
const server = http.createServer(app);
const io = socketio(server);
const users = {};

// Serve static files (like script.js, style.css, etc.)
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(session({
    secret: "secret-key",
    resave: false,
    saveUninitialized: false
}));


const templatePath = path.join(__dirname, 'templates');
app.set("views", templatePath);
app.set("view engine", "hbs");


// ====== LOGIN & SIGNUP ROUTES ======
app.get("/", (req, res) => {
    res.render("login");
})
app.get("/signup", (req, res) => {
    res.render("signup");
})
app.get("/login", (req, res) => {
    res.render("login");
});
app.get("/requests", (req, res) => {
    res.render("reqpage");
});
app.get("/sent", (req, res) => {
    res.render("sent");
});
app.get("/chat", (req, res) => {
    if (!req.session.username) {
        return res.redirect("/login"); // or send an error
    }
    res.render("chat", { username: req.session.username });
});

// Get friend requests for current user
app.get("/get-requests", async (req, res) => {
    const username = req.session.username; 
    if (!username) return res.status(401).json({ error: "Not logged in" });

    try {
        const user = await collection.findOne({ name: username });

        if (!user) return res.status(404).json({ error: "User not found" });

        // default empty arrays if not defined
        const received = user.friendRequests || [];
        const sent = user.sentRequests || [];

        res.json({ received, sent });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});


app.get("/get-friends", async (req, res) => {
    const username = req.session.username;
    if (!username) return res.status(401).json({ error: "Not logged in" });

    try {
        const user = await collection.findOne({ name: username });
        if (!user) return res.status(404).json({ error: "User not found" });

        const friends = user.friends || [];
        res.json({ friends });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});


app.post("/signup", async (req, res) => {

    const data = {
        name: req.body.name,
        password: req.body.password
    }

    await collection.insertOne(data)

    res.render("login");
})

app.post("/login", async (req, res) => {
    try {
        const check = await collection.findOne({ name: req.body.name });

        if (!check) {
            return res.status(404).json({ error: "User not found" });
        }

        if (check.password === req.body.password) {
            // ✅ Save username in session
            req.session.username = check.name;

            return res.redirect("/chat");

        } else {
            return res.status(401).json({ error: "Wrong password" });
        }
    } catch (err) {
        console.error("Login error:", err);
        return res.status(500).json({ error: "Something went wrong" });
    }
});




// Send friend request
app.post("/send-request", async (req, res) => {
    const { from, to } = req.body;

    try {
        if (from === to) {
            return res.status(400).json({ error: "You can't send a request to yourself." });
        }

        const sender = await collection.findOne({ name: from });
        const receiver = await collection.findOne({ name: to });

        if (!sender || !receiver) {
            return res.status(404).json({ error: "User not found." });
        }

        if (sender.friends.includes(to)) {
            return res.status(400).json({ error: "Already friends." });
        }

        if (sender.sentRequests.includes(to) || receiver.friendRequests.includes(from)) {
            return res.status(400).json({ error: "Request already sent." });
        }

        await collection.updateOne(
            { name: from },
            { $addToSet: { sentRequests: to } }
        );
        await collection.updateOne(
            { name: to },
            { $addToSet: { friendRequests: from } }
        );

        return res.json({ success: true, message: "Request sent!" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Error sending request." });
    }
});


// Accept friend request
app.post("/accept-request", async (req, res) => {
    const { from, to } = req.body;

    try {
        const sender = await collection.findOne({ name: from });
        const receiver = await collection.findOne({ name: to });

        if (!sender || !receiver) {
            return res.status(404).json({ error: "User not found." });
        }

        if (!receiver.friendRequests.includes(from)) {
            return res.status(400).json({ error: "No such request." });
        }

        // Remove request from both sides
        await collection.updateOne({ name: to }, { $pull: { friendRequests: from } });
        await collection.updateOne({ name: from }, { $pull: { sentRequests: to } });

        // Add to friends list for both
        await collection.updateOne({ name: to }, { $addToSet: { friends: from } });
        await collection.updateOne({ name: from }, { $addToSet: { friends: to } });

        return res.json({ success: true, message: "Friend request accepted!" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Error accepting request." });
    }
});


// Deny friend request
app.post("/deny-request", async (req, res) => {
    const { from, to } = req.body;

    try {
        const sender = await collection.findOne({ name: from });
        const receiver = await collection.findOne({ name: to });

        if (!sender || !receiver) {
            return res.status(404).json({ error: "User not found." });
        }

        if (!receiver.friendRequests.includes(from)) {
            return res.status(400).json({ error: "No such request." });
        }

        // Remove from both request lists
        await collection.updateOne({ name: to }, { $pull: { friendRequests: from } });
        await collection.updateOne({ name: from }, { $pull: { sentRequests: to } });

        return res.json({ success: true, message: "Friend request denied." });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Error denying request." });
    }
});




// ====== CHAT LOGIC ======
io.on('connection', socket => {
    // When new user joins
    socket.on('new-user-joined', name => {
        users[socket.id] = name;
        socket.broadcast.emit('user-joined', name);
        console.log("New user joined:", name);
    });

    // When user sends a message
    socket.on('send', message => {
        socket.broadcast.emit('recieve', {
            message: message,
            name: users[socket.id]
        });
    });

    // When user disconnects (closes tab)
    socket.on('disconnect', () => {
        const name = users[socket.id] || 'A user';
        socket.broadcast.emit('left', name);
        console.log(`${name} disconnected`);
        delete users[socket.id];
    });
});

// Search user by name
app.get("/search-user", async (req, res) => {
    const username = req.query.username?.trim();

    if (!username) {
        return res.status(400).json({ error: "Username is required" });
    }

    try {
        const user = await collection.findOne({ name: username });

        if (!user) {
            return res.json({ exists: false });
        }

        res.json({ exists: true, user: { username: user.name } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

app.post("/send-request", (req, res) => {
    const { from, to } = req.body;

    // Validate inputs
    if (!from || !to) {
        return res.status(400).json({ error: "Both sender and recipient are required" });
    }

    if (from === to) {
        return res.status(400).json({ error: "You cannot send a request to yourself" });
    }

    // Demo response
    console.log(`Friend request from ${from} to ${to}`);

    // Always JSON
    return res.status(200).json({ message: "Request sent!" });
});





// Start server
server.listen(8000, '0.0.0.0', () => {
    console.log('Server running at http://0.0.0.0:8000');
});

