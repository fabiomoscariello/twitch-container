# twitch-container — Twitch Stream Proxy

**Team:** BE | **Agente:** `/twitch`

Microservizio Node.js che estrae l'URL m3u8 diretto degli stream Twitch tramite `yt-dlp` e lo proxia all'app Android Telenuova TV.

## Architettura

```
twitch-container/
├── index.js            # Entry point — tutto il codice applicativo
├── package.json
├── Dockerfile          # Node 18 + apt (python3, ffmpeg) + yt-dlp via pip3
└── README.md
```

## Stack
- **Runtime:** Node.js 18, CommonJS
- **Framework:** Express 4
- **CORS:** `cors`
- **Proxy:** `http-proxy-middleware` (per forward stream)
- **Stream extraction:** `yt-dlp` (processo figlio via `child_process.exec`)
- **Cache:** `Map` in-memory (channel → {streamUrl, parsed})
- **Auth Twitch:** OAuth via `TWITCH_CLIENT_ID` + `TWITCH_SECRET`

## Variabili d'Ambiente

| Var | Obbligatoria | Note |
|---|---|---|
| `TWITCH_CLIENT_ID` | Sì | Twitch Developer App |
| `TWITCH_SECRET` | Sì | Twitch Developer App |
| `PORT` | No | Default 3000 |

## API

```
GET /get-stream?channel=<channel_name>
```

Risponde con l'URL m3u8 del canale (estratto da yt-dlp, cachato in memoria).

## Docker

```dockerfile
# Node 18, installa: python3, pip3, ffmpeg, yt-dlp, npm deps
docker build -t twitch-container .
docker run -e TWITCH_CLIENT_ID=... -e TWITCH_SECRET=... -p 3000:3000 twitch-container
```

## Regole Specifiche

- `yt-dlp` deve essere aggiornato nell'immagine Docker per compatibilità con Twitch (le URL cambiano frequentemente)
- La cache in-memory (`streamCache` Map) non ha TTL esplicito: valutare refresh periodico se le URL scadono
- Non loggare mai le URL complete degli stream nei log produzione (possono contenere token)
- `TWITCH_CLIENT_ID` e `TWITCH_SECRET` mai committati: solo via env
- Il Dockerfile usa `--break-system-packages` per pip3: necessario su Debian 12+ (Bookworm)

## File Chiave

- `index.js` — tutta la logica (stream extraction, cache, proxy, Twitch OAuth)
- `Dockerfile` — build immagine con yt-dlp
