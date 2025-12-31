import asyncio
import logging

import db
import setup


log = logging.getLogger()


async def main():
    await db.setup_relations()

    bg_tasks = setup.setup_background_tasks()
    bg_tasks.start()

    bot = setup.bot()
    dp = setup.dispatcher()

    try:
        await dp.start_polling(bot)
    except KeyboardInterrupt:
        log.info("Stop polling...")
    except Exception as err:
        log.exception("Polling error:", err)


if __name__ == "__main__":
    setup.setup_logs()
    asyncio.run(main())
