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
- **Stream extraction:** Twitch GQL API (`streamPlaybackAccessToken`) + redirect a Usher HLS — nessun binario esterno
- **Cache:** `Map` in-memory (channel → {url, cachedAt}), TTL 3 min
- **Auth Twitch:** OAuth app token via `TWITCH_CLIENT_ID` + `TWITCH_SECRET`, token cachato in-process
- **Deploy:** Vercel (serverless, `vercel.json` incluso) o qualsiasi runtime Node 18+

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

Il `Dockerfile` esistente non è più necessario per Vercel. Rimane utile per deploy self-hosted:
```bash
docker build -t twitch-container .
docker run -e TWITCH_CLIENT_ID=... -e TWITCH_SECRET=... -p 3000:3000 twitch-container
```

## Regole Specifiche

- Nessun binario esterno: lo stream URL viene risolto via Twitch OAuth + GQL API
- La cache in-memory ha TTL 3 min: le URL Usher scadono in pochi minuti, non aumentare il TTL
- Non loggare mai le URL complete degli stream in produzione (contengono token firmati)
- `TWITCH_CLIENT_ID` e `TWITCH_SECRET` mai committati: solo via env var (Vercel dashboard o `.env` locale)
- Su Vercel il token OAuth è cachato in-process ma reset a ogni cold start: accettabile

## File Chiave

- `index.js` — tutta la logica (stream extraction, cache, proxy, Twitch OAuth)
- `Dockerfile` — build immagine con yt-dlp
