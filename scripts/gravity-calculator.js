const { Window } = require("skia-canvas");

const window = new Window({ width: 800, height: 600 });
const canvas = window.canvas;
const ctx = canvas.getContext("2d");

const pixelsPerMeter = 100;
const g = 9.8 * pixelsPerMeter;

let ball = {
    x: 400,
    y: 100,
    vy: 0,
    radius: 20
};

let lastTime = Date.now();

function physics(dt) {

    ball.vy += g * dt;
    ball.y += ball.vy * dt;

    if (ball.y + ball.radius > canvas.height) {
        ball.y = canvas.height - ball.radius;
        ball.vy *= -0.8;
    }
}

function render() {

    ctx.clearRect(0,0,canvas.width,canvas.height);

    ctx.fillStyle = "#333";
    ctx.fillRect(0, canvas.height-10, canvas.width, 10);

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI*2);
    ctx.fillStyle = "#4ec3ff";
    ctx.fill();
}

function loop(){

    const now = Date.now();
    const dt = (now - lastTime)/1000;
    lastTime = now;

    physics(dt);
    render();
}

// ~60 FPS
setInterval(loop, 1000/60);