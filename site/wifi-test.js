// Wi-Fi room test: what can a web page see of the network, and does it differ between rooms?
// A browser cannot read the access point (BSSID); scripts/wifi_probe.sh records that on a Mac for comparison.
const KEY = "wifiTestSamples";
const $ = (id) => document.getElementById(id);
let current = null;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const store = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
const isPublic = (ip) => ip && !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.)/.test(ip);

async function publicIp() {
  // our server first (the deployed site); a public echo service when testing locally, where the server sees 127.0.0.1
  for (const url of ["/api/whoami", "https://api.ipify.org?format=json"]) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      const ip = r.ok && (await r.json()).ip;
      if (isPublic(ip)) return ip;
    } catch {}
  }
  return null;
}

async function localCandidates() {
  // without a STUN server only host candidates come back; modern browsers hide them behind random *.local names
  const found = new Set();
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel("x");
    pc.onicecandidate = (e) => { if (e.candidate) found.add(e.candidate.candidate.split(" ")[4]); };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((ok) => setTimeout(ok, 1500));
    pc.close();
  } catch {}
  return [...found];
}

async function probe() {
  $("now").textContent = "Probing…";
  const [ip, local] = await Promise.all([publicIp(), localCandidates()]);
  const c = navigator.connection || {};
  current = { ip, local, type: c.type || c.effectiveType || null };
  $("now").textContent =
    `Public IP:         ${ip || "unknown"}\n` +
    `Local candidates:  ${local.join(", ") || "none"}\n` +
    `Connection type:   ${current.type || "not exposed"}`;
  guess();
}

function guess() {
  const same = load().filter((s) => current && s.ip && s.ip === current.ip);
  const rooms = [...new Set(same.map((s) => s.room))];
  $("guess").textContent = !current ? "" :
    !load().length ? "Save samples in a few rooms, then come back to see if this page can tell them apart." :
    rooms.length === 1 ? `Looks like: ${rooms[0]}` :
    rooms.length ? `Can't tell: this IP was seen in ${rooms.join(", ")}` :
    "No saved room has this IP.";
}

function render() {
  $("rows").replaceChildren(...load().slice().reverse().map((s) => {
    const tr = document.createElement("tr");
    for (const v of [s.time.slice(5, 16).replace("T", " "), s.room, s.ip || "?", s.local.join(", ")]) {
      const td = document.createElement("td"); td.textContent = v; tr.append(td);
    }
    return tr;
  }));
  guess();
}

$("save").onclick = () => {
  const room = $("room").value.trim();
  if (!room || !current) return $("room").focus();
  store([...load(), { time: new Date().toISOString(), room, ...current }]);
  render();
};
$("again").onclick = probe;
$("export").onclick = () => navigator.clipboard?.writeText(JSON.stringify(load(), null, 1));
$("clear").onclick = () => { if (confirm("Delete all samples in this browser?")) { store([]); render(); } };

render();
probe();
