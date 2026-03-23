# Setup Guide

## 1. Create a Strava API application

1. Go to https://www.strava.com/settings/api
2. Create a new application (name/description can be anything)
3. Note your **Client ID** and **Client Secret**
4. Set "Authorization Callback Domain" to `localhost`

## 2. Get your Strava refresh token

Run this one-time flow to get a refresh token:

### Step 1 — Open this URL in your browser (replace YOUR_CLIENT_ID):
```
https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all
```

### Step 2 — After authorizing, grab the `code` from the redirect URL:
```
http://localhost/?state=&code=XXXXXXXXXXXXXXXX&scope=read,activity:read_all
```

### Step 3 — Exchange the code for a refresh token (replace placeholders):
```bash
curl -X POST https://www.strava.com/oauth/token \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d code=YOUR_CODE \
  -d grant_type=authorization_code
```

The response includes `refresh_token` — copy that value.

## 3. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in all four values
```

## 4. Add your coaching prompt

Open `server.js` and replace `COACHING_SYSTEM_PROMPT_PLACEHOLDER` with your coaching system prompt.

## 5. Run locally

```bash
npm install
npm start
# → http://localhost:3000
```

## 6. Run with Docker

```bash
# Create an empty workouts.json so the volume mount works
echo '[]' > workouts.json

docker compose up --build
# → http://localhost:3000
```

To run on your laptop server, copy the repo there, create `.env`, and run:
```bash
docker compose up -d
```

The `restart: unless-stopped` policy means it will survive reboots.
