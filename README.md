# Framered

Framered is a deploy-ready MVP video platform for `framered.lat`. It includes a Node.js backend, responsive frontend, local session authentication, video upload/storage, searchable video listings, watch pages, likes, comments, profiles, and subscriptions.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Deploy

1. Upload this folder to a Node.js host.
2. Set environment variables from `.env.example` as needed.
3. Run `npm install`.
4. Run `npm start`.

The app stores data in `storage/db.json`, uploaded videos in `storage/videos`, and uploaded posters in `storage/posters`.

## Default demo account

The first run creates seeded public videos and a demo account:

- Email: `demo@framered.lat`
- Password: `framered`

## Notes

- This MVP intentionally uses file storage so it is easy to inspect, back up, and deploy.
- For large production traffic, move videos to object storage, put the app behind HTTPS, and replace the JSON store with PostgreSQL or another durable database.
