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

Visit `http://192.168.4.27:3001` for now, or whatever you set in `APP_URL`.

## Import your spreadsheet

Put your `.xlsx`, `.xls`, or `.csv` file in the `import/` folder, then run:

```bash
docker compose run --rm app npm run import
```

If you want to target a specific file:

```bash
docker compose run --rm app npm run import -- /imports/your-file.xlsx
```

## Expected import columns

The importer looks for columns like:

- `Lukia`, `Name`, `Phrase`, or `Title`
- `Author`, `Made By`, `Creator`, or `Who`
- `Date`, `Created`, or `Posted`

If the phrase cell only says `bowling ball`, the importer stores it as `Lukia bowling ball`.

## Change the database password safely

If you already have data in `db-data/`, changing `POSTGRES_PASSWORD` in `.env` is not enough by itself. The existing Postgres user inside the database must also be updated.

1. Update `POSTGRES_PASSWORD` in `.env`.
2. Apply the same password inside Postgres:

```bash
docker compose exec -T db psql -U lukia -d lukiarank -c "ALTER USER lukia WITH PASSWORD 'YOUR_NEW_PASSWORD';"
```

3. Restart the app so it reconnects with the new password:

```bash
docker compose restart app
```

If you do not care about keeping existing data, you can instead delete `db-data/` and recreate the stack from scratch.

## View the database files

The `db-data/` folder on the host may look empty because PostgreSQL sets strict permissions on it. To inspect the database files safely, look from inside the container instead:

```bash
docker compose exec db ls -la /var/lib/postgresql/data
```

## Notes for later

- You can put this behind your final domain later by changing `APP_URL`.
- We can add a reverse proxy and lock down Pi/firewall rules once the app itself is in place.
