const socket = io(`${location.hostname}:8000`);


const form = document.getElementById('send-container');
const msgInput = document.getElementById('msginp');
const msgContainer = document.querySelector(".msgcontainer");
var audio = new Audio('soft_notification.mp3');

const append = (message, position) => {
    const msgElement = document.createElement('div');
    msgElement.innerText = message;
    msgElement.classList.add('message');
    msgElement.classList.add(position);
    msgContainer.append(msgElement);
    console.log("Appending message:", message, "at", position);
    if(position == 'left'){
        audio.play();
    }
};

// Send message on form submit
form.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = msgInput.value;
    append(`You: ${message}`, 'right');
    socket.emit('send', message);
    msgInput.value = '';
});

// Prompt name only after connection is established
socket.on('connect', () => {
    socket.emit('new-user-joined', loggedInUser);
});

// New user joined
socket.on('user-joined', name => {
    append(`${name} joined the chat`, 'left');
});

// Message received from another user
socket.on('recieve', data => {
    append(`${data.name}: ${data.message}`, 'left');
});

// User left the chat
socket.on('left', name => {
    append(`${name} left the chat`, 'left');
});



