const WebSocket = require("ws");
const db = require("./firebase");
const sendFCM = require("./fcm");

function connect(symbols, isFutures) {
  const urlBase = isFutures
    ? "wss://fstream.binance.com/stream?streams="
    : "wss://stream.binance.com:9443/stream?streams=";

  const streams = symbols.map(s => `${s.toLowerCase()}@trade`).join("/");
  const ws = new WebSocket(urlBase + streams);

  ws.on("message", async (data) => {
    try {
      const json = JSON.parse(data);
      const tick = json.data || json;
      const symbol = tick.s;
      const price = parseFloat(tick.p);

      const snap = await db
        .ref("signals")
        .orderByChild("coinName")
        .equalTo(symbol)
        .once("value");

      snap.forEach(child => {
        const signal = child.val();
        const id = child.key;
        if (signal.statusFrozen) return;

        const targets = ["target1","target2","target3","target4"];
        let allHit = true;

        targets.forEach(key => {
          const t = parseFloat(signal[key]);
          const hit = signal.direction==="Short"
            ? price<=t
            : price>=t;
          const alreadyHit = signal.targetHits?.[key];

          if (hit && !alreadyHit) {
            db.ref(`signals/${id}/targetHits/${key}`).set(true);
            db.ref("notifications")
              .push({ message:`${symbol} → ${key} Hit`, timestamp:Date.now() });
            sendFCM("🎯 Target Hit",`${symbol} hit ${key}`);
          }
          if (!(alreadyHit||hit)) allHit = false;
        });

        const stopLoss = parseFloat(signal.stopLoss);
        const slHit = signal.direction==="Short"
          ? price>=stopLoss
          : price<=stopLoss;

        if (slHit && signal.status!=="SL") {
          db.ref(`signals/${id}/status`).set("SL");
          db.ref(`signals/${id}/statusFrozen`).set(true);
          db.ref("notifications")
            .push({ message:`${symbol} → SL Hit`, timestamp:Date.now() });
          sendFCM("❌ Stoploss Hit",`${symbol} hit Stoploss`);
        } else if (allHit && signal.status!=="Complete") {
          db.ref(`signals/${id}/status`).set("Complete");
          db.ref(`signals/${id}/statusFrozen`).set(true);
          db.ref("notifications")
            .push({ message:`${symbol} → Signal Complete 🎯`, timestamp:Date.now() });
          sendFCM("✅ Signal Complete",`${symbol} signal completed`);
        }
      });
    } catch (err) {
      console.log("❌ Error:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("⛔ WebSocket closed. Reconnecting...");
    setTimeout(() => connect(symbols, isFutures), 5000);
  });
}

async function start() {
  const snapshot = await db.ref("signals").once("value");
  const spot = new Set();
  const futures = new Set();

  snapshot.forEach(snap => {
    const s = snap.val();
    if (s.tradeType==="Spot") spot.add(s.coinName);
    else futures.add(s.coinName);
  });

  connect([...spot], false);
  connect([...futures], true);
}

start();
