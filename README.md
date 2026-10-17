# Telegram bot for grafik-zhytomyr

This bot monitors the existing repository's published JSON data and sends notifications when the data changes.

## GitHub Actions deployment

Add repository secrets:
- `BOT_TOKEN`: token from @BotFather
- `CHANNEL_ID`: channel username (for example `@your_channel`) or numeric channel ID

The existing repository workflow should install `requirements.txt`, run `bot.py` as a long-running service only on a host that supports persistent processes. GitHub Actions scheduled jobs are not a permanent bot host. For a continuously running bot, deploy this project as a worker on Railway or another host.

## Important limitations

- On the first successful poll, the bot stores a baseline and does not send a change notification.
- The bot announces changes to the published JSON data; it does not yet calculate exact queue-specific outage intervals from cell colors.
- For production use, configure persistent storage for `bot_state.json`; otherwise restart/redeploy may reset the notification baseline and subscribers.
- Keep `BOT_TOKEN` secret. Never commit it to the repository.
