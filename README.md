# 🎥 Twitch Stream Extractor API

Questo progetto è una microAPI Docker-ready che consente di recuperare l'URL `.m3u8` di uno stream **Twitch live** da un determinato canale.

---

## 🚀 Funzionalità

- Estrae lo stream `.m3u8` usando `yt-dlp`
- API REST semplificata su `/get-stream?channel=<nome_canale>`
- Deployabile via Docker
- Supporto per configurazione tramite `.env`

---

## 🛠️ Prerequisiti

- [Node.js](https://nodejs.org/)
- [Docker](https://www.docker.com/)
- Account Twitch Developer con una app registrata per ottenere `client_id` e `secret`

---

## 📁 Configurazione `.env`

Per far funzionare il progetto, crea un file `.env` nella root del repository.

Puoi partire da questo esempio:

```dotenv
# .env

# Twitch API credentials (do not commit this file with real secrets)
TWITCH_CLIENT_ID=your_client_id_here
TWITCH_SECRET=your_client_secret_here
