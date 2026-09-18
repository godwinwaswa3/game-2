# Database-configured Peanut Unit economy

The economy is now controlled by MariaDB, not hard-coded in the browser.

Run:

```bash
mysql -u root -p peanut_game < mariadb-feature-migration.sql
```

The `economy_config` row controls:

- initial balance: 5.000000
- interest rate: 15% per 60 seconds
- plot interval: 5 seconds
- round duration: 30 seconds

The server calculates the amount and stores each 5-second snapshot in
`economy_snapshots`. The browser only displays the server configuration and
server snapshots.

Restart the API and curl proxy after installing the updated files.
