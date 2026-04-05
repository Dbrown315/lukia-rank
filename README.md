# Lukia Rank

Simple Dockerized website for posting, browsing, sorting, and rating Lukias.

## What it does

- Name-based login with no passwords
- Post new Lukias with an author and date
- Rate each Lukia from 1 to 5 stars
- Sort by best, worst, recent, oldest, and author
- Import historical data from an Excel or CSV file

## Start it

```bash
docker compose up -d --build
```

Visit the URL you set in `APP_URL`. For example, if you are using Tailscale Funnel, that will be something like `https://your-device.your-tailnet.ts.net`.

## Import your spreadsheet

Put your `.xlsx`, `.xls`, or `.csv` file in the `import/` folder, then run:

```bash
docker compose run --rm app npm run import
```

If you want to target a specific file:

```bash
docker compose run --rm app npm run import -- /imports/your-file.xlsx
```

## Back up the database

For normal protection against a lost Docker volume, use PostgreSQL dumps instead of re-importing spreadsheets.

Create a backup on demand:

```bash
./scripts/backup-db.sh
```

That writes a PostgreSQL custom-format dump into the local `backups/` folder on the Pi, using filenames like:

```text
backups/lukiarank_2026-04-05_02-00-00.dump
```

Backups older than 30 days are deleted automatically. To keep a different number of days:

```bash
BACKUP_RETENTION_DAYS=14 ./scripts/backup-db.sh
```

If you want the dev stack instead of the main one:

```bash
./scripts/backup-db.sh --dev
```

## Restore from a backup

If you ever lose the Docker volume, bring the stack back up so Postgres is running, then restore one of the dumps:

```bash
docker compose up -d
./scripts/restore-db.sh lukiarank_2026-04-05_02-00-00.dump
```

You can also pass a full path:

```bash
./scripts/restore-db.sh /data/srv/lukia-rank/backups/lukiarank_2026-04-05_02-00-00.dump
```

The restore script temporarily stops the app container, restores the database, then starts the app again.

## Nightly backups on the Pi

To run a backup every night at 2:00 AM, edit the host crontab:

```bash
crontab -e
```

Add:

```cron
0 2 * * * cd /data/srv/lukia-rank && /bin/bash ./scripts/backup-db.sh >> /data/srv/lukia-rank/backups/backup.log 2>&1
```

That schedule means 2:00 AM every day on the Raspberry Pi host. If you want the dev stack instead, use `./scripts/backup-db.sh --dev`.

## Expected import columns

The importer looks for columns like:

- `Lukia`, `Name`, `Phrase`, or `Title`
- `Author`, `Made By`, `Creator`, or `Who`
- `Date`, `Created`, or `Posted`

If the phrase cell only says `bowling ball`, the importer stores it as `Lukia bowling ball`.

## Change the database password safely

If you already have data in the Docker volume, changing `POSTGRES_PASSWORD` in `.env` is not enough by itself. The existing Postgres user inside the database must also be updated.

1. Update `POSTGRES_PASSWORD` in `.env`.
2. Apply the same password inside Postgres:

```bash
docker compose exec -T db psql -U lukia -d lukiarank -c "ALTER USER lukia WITH PASSWORD 'YOUR_NEW_PASSWORD';"
```

3. Restart the app so it reconnects with the new password:

```bash
docker compose restart app
```

If you do not care about keeping existing data, you can instead recreate the stack and remove the database volume:

```bash
docker compose down -v
docker compose up -d --build
```

## View the database files

PostgreSQL now stores its data in the Docker-managed `postgres-data` volume. To inspect the database files safely, look from inside the container:

```bash
docker compose exec db ls -la /var/lib/postgresql/data
```

## Reset the database completely

If you want to wipe all Lukias, users, and ratings and start fresh:

```bash
docker compose down -v
docker compose up -d --build
```

Then import your spreadsheet again:

```bash
docker compose run --rm app npm run import -- "/imports/Lukia Import.xlsx"
```

## Notes for later

- You can put this behind your final domain later by changing `APP_URL`.
- We can add a reverse proxy and lock down Pi/firewall rules once the app itself is in place.

## Expose it with Tailscale Funnel

If this machine is logged into your tailnet and allowed to use Funnel, you can publish the app without opening router ports.

1. Start the app:

```bash
docker compose up -d --build
```

2. Start the Tailscale daemon on the host if it is not already running:

```bash
sudo systemctl start tailscaled
```

3. Sign in to Tailscale on the host if needed:

```bash
sudo tailscale up
```

4. Check your device's Tailscale HTTPS name:

```bash
tailscale status
tailscale cert <your-device-name>.<your-tailnet>.ts.net
```

5. Change `APP_URL` in `.env` to your HTTPS `ts.net` URL, then restart the app:

```bash
docker compose restart app
```

6. Publish the app's host port:

```bash
sudo tailscale funnel 3001
```

After that, your site should be reachable at the `https://<device>.<tailnet>.ts.net` address shown by Tailscale.
