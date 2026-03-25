# Running Coach

An AI-powered running coach that connects to your Strava account and uses Claude to generate personalized workout recommendations based on your training history.

![Dashboard](dashboard.png)

## Features

- Pulls your run history from Strava automatically
- Generates a recommended workout + alternatives using Claude (claude-sonnet-4-6)
- Follows the 80/20 polarized training method by default
- Tracks which workout you selected each day
- Plan workouts for future dates on the calendar
- Persists your goal, race target, cross-training notes, and injury context
- Cost estimate before every generation (~$0.02 per request)
- Self-hostable with Docker, protected by a password

---

## Screenshots

![Generate modal](generate.png)

![Settings](settings.png)

---

## Self-hosting with Docker

### 1. Get a Strava API key

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api) and create an application
2. Note your **Client ID** and **Client Secret**
3. Set "Authorization Callback Domain" to `localhost`

Run this one-time OAuth flow to get a refresh token.

**Step 1** — Open this URL in your browser (replace `YOUR_CLIENT_ID`):
```
https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all
```

**Step 2** — After authorizing, copy the `code` from the redirect URL:
```
http://localhost/?state=&code=XXXXXXXXXXXXXXXX&scope=read,activity:read_all
```

**Step 3** — Exchange it for a refresh token:
```bash
curl -X POST https://www.strava.com/oauth/token \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d code=YOUR_CODE \
  -d grant_type=authorization_code
```

Copy the `refresh_token` from the response.

### 2. Get an Anthropic API key

Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key.

### 3. Run the container

```bash
docker run -d \
  --name running-coach \
  --restart unless-stopped \
  -p 3000:3000 \
  -v ./data:/app/data \
  -e APP_PASSWORD=yourpassword \
  -e SESSION_SECRET=anyrandomstring \
  ghcr.io/rileygriffith/running-coach:latest
```

Then open `http://localhost:3000`, log in with your password, and enter your Strava and Anthropic credentials in the Settings tab.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_PASSWORD` | Yes | Password to log in to the app |
| `SESSION_SECRET` | Yes | Any random string used to sign session cookies |
| `ANTHROPIC_API_KEY` | Optional | Can be set here or in the Settings tab |
| `STRAVA_CLIENT_ID` | Optional | Can be set here or in the Settings tab |
| `STRAVA_CLIENT_SECRET` | Optional | Can be set here or in the Settings tab |
| `STRAVA_REFRESH_TOKEN` | Optional | Can be set here or in the Settings tab |

Credentials set via the Settings tab are stored in the local database and take precedence over environment variables.

### Data persistence

The SQLite database lives at `/app/data/coach.db` inside the container. The `-v ./data:/app/data` mount keeps it on your host machine so it survives container updates.

---

## Running locally

```bash
git clone https://github.com/rileygriffith/running-coach
cd running-coach
cp .env.example .env
# Fill in .env with your credentials
npm install
npm start
# → http://localhost:3000
```

---

## How it works

1. On load the app syncs your recent runs from Strava (cached for 1 hour)
2. Click **Generate Workout** for today or select a future date on the calendar
3. Review the prompt, set soreness level if relevant, and send to Claude
4. A recommended workout is shown — swipe through alternatives if you want something different
5. Select the workout you plan to do (or come back after your run to log which one you did)
6. Your selection is stored and included in future prompts so the coach builds on your history
