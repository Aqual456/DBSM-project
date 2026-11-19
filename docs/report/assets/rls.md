| Executed as | Query | Result |
|---|---|---|
| postgres (owner) | `SELECT count(*) FROM deliveries` | 6 rows |
| rf_driver (user 11) | `SELECT count(*) FROM deliveries` | 2 rows (own deliveries only) |
| rf_driver | `SELECT password_hash FROM app_users` | ERROR: permission denied for table app_users |
