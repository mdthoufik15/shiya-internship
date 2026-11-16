# Shiya Tech Solutions – Internship Portal

## Run it
1. Install Node.js 18 or newer (nodejs.org).
2. In this folder: `npm install`
3. Copy `.env.example` to `.env` and fill it in (see "Email setup").
4. `npm start`
5. Open http://localhost:3000  (applications admin: http://localhost:3000/admin)

Put your logo at `public/logo.png`.

## Where data is stored
- Applications: `data/applications.db` (SQLite file)
- Resumes: `data/resumes/` (random file names, not publicly reachable)
- Only the admin page (password protected) can view or download them.
- Back up the whole `data/` folder regularly.

## Email setup (Gmail)
1. Turn on 2-Step Verification for shiyatechsolutions@gmail.com.
2. Google Account -> Security -> App passwords -> create one.
3. Put the 16-character password in `SMTP_PASS` in `.env`.
Without SMTP settings the portal still works, but no emails are sent.

## What emails are sent
- Applicant: confirmation with application ID.
- Company: new application details with resume attached.
- Applicant: update whenever you change the status in /admin.

## Deploying
Needs a host that runs Node.js and keeps files: a VPS (DigitalOcean, AWS Lightsail),
or Render/Railway with a persistent disk mounted on `data/`.
Hosts without persistent disks delete `data/` on restart.
