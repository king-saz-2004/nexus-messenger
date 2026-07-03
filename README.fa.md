<div dir="rtl" align="right">

# Nexus Messenger

زبان‌ها: [English](README.md) | [فارسی](README.fa.md)

نسخه: 1.0.0  
وضعیت پروژه: v1.0.0 پایدار  
پیام‌رسان real-time و self-hosted

ساخته‌شده با توسعه‌ی مبتنی بر هوش مصنوعی؛ ایده، بررسی محصول، تست و تصمیم‌های انتشار توسط Ashin Team انجام شده است.

Nexus Messenger یک پلتفرم پیام‌رسان self-hosted برای چت مستقیم، گروه، ارسال فایل و مدیا، پیام صوتی، وضعیت آنلاین، واکنش‌ها، رسید خواندن پیام و راه‌اندازی با Docker Compose است.

مسیر اصلی نصب و انتشار نسخه 1.0.0 با Docker Compose است. ابزار نصب خودکار/CLI برای نسخه‌های آینده برنامه‌ریزی شده است.

## چرا این پروژه ساخته شد؟

Nexus Messenger از یک آزمایش شروع شد: هوش مصنوعی تا چه حد می‌تواند یک اپلیکیشن واقعی و self-hosted برای چت بسازد، وقتی سازنده انسانی خودش خط‌به‌خط کدنویسی نمی‌کند؟

ایده، مسیر محصول، بررسی قابلیت‌ها، تست، تصمیم‌گیری‌ها و کنترل کیفیت توسط سازنده انسانی انجام شد. پیاده‌سازی پروژه به‌صورت مرحله‌به‌مرحله با کمک هوش مصنوعی جلو رفت.

هدف این پروژه ساخت یک کلون از پیام‌رسان‌های بزرگ نبود. هدف این بود که یک پیام‌رسان self-hosted، مدرن و متمرکز ساخته شود که قابلیت‌های اصلی یک محصول واقعی را داشته باشد: چت مستقیم، گروه، پیام‌رسانی real-time، مدیا، نقش‌های کاربری، وضعیت آنلاین و ابزارهای راه‌اندازی.

این پروژه همچنین از یک نیاز ساده شروع شد: بعضی ابزارهای چت self-hosted یا تیمی برای استفاده‌های کوچک و متوسط بیش از حد شلوغ و سنگین هستند. Nexus Messenger تلاش می‌کند تجربه‌ای تمیزتر، ساده‌تر و قابل‌فهم‌تر ارائه دهد.

## پیش‌نمایش

![نمای چت Nexus Messenger](docs/assets/screenshots/chat.png)

![نمای مدیریت گروه و پنل مدیریت Nexus Messenger](docs/assets/screenshots/management-panels.png)

## قابلیت‌ها

- چت مستقیم و چت گروهی
- مدیریت مالک، مدیر، عضو، مجوزها، بن کردن اعضا و انتقال مالکیت گروه
- پیام‌رسانی real-time با Socket.IO
- پاسخ به پیام، ویرایش، حذف، پین کردن، جستجو، واکنش، شمارنده پیام‌های خوانده‌نشده و رسید خواندن
- نمایش وضعیت تایپ و آنلاین/آفلاین بودن کاربران
- ارسال فایل و مدیا با محدودیت‌های قابل تنظیم
- ضبط و پخش پیام صوتی
- مخاطبین و جستجوی کاربر
- ساخت خودکار کاربر root/admin، تایید ثبت‌نام خصوصی، تنظیمات ثبت‌نام، محدودیت مدیا و ابزارهای مدیریتی
- پشتیبانی از رابط انگلیسی و فارسی با چیدمان راست‌به‌چپ
- پشتیبانی از Progressive Web App (PWA) برای استفاده نصب‌پذیر شبیه اپلیکیشن
- راه‌اندازی با Docker Compose، PostgreSQL و Redis

## پیش‌نیازها

- Node.js نسخه 22 یا جدیدتر
- npm
- Docker Engine یا Docker Desktop
- افزونه Docker Compose

## راه‌اندازی توسعه محلی

نصب وابستگی‌ها:

```bash
npm ci
npm --prefix backend ci
```

ساخت فایل‌های محیطی:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

فایل‌های `.env` را ویرایش کنید و برای رمزهای دیتابیس، `JWT_SECRET`، `JWT_REFRESH_SECRET`، `DEFAULT_ROOT_USERNAME` و `DEFAULT_ROOT_PASSWORD` مقدارهای امن قرار دهید.

اجرای محیط توسعه:

```bash
npm run dev:all
```

این دستور PostgreSQL و Redis را با Docker اجرا می‌کند، API بک‌اند را روی `http://localhost:4000` و فرانت‌اند Vite را روی `http://localhost:3000` بالا می‌آورد.

کاربر root/admin هنگام شروع برنامه از روی `DEFAULT_ROOT_USERNAME` و `DEFAULT_ROOT_PASSWORD` ساخته می‌شود. در نسخه 1.0.0 ابزار نصب عمومی جداگانه‌ای وجود ندارد.

دستورهای بررسی:

```bash
npm run typecheck
npm run build
npm --prefix backend run typecheck
npm --prefix backend run build
```

## نصب با Docker Compose

فایل نمونه محیطی را کپی کنید:

```bash
cp .env.example .env
```

قبل از اجرا مقدارهای production را تنظیم کنید:

- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `POSTGRES_PASSWORD`
- `APP_DB_PASSWORD`
- `DEFAULT_ROOT_USERNAME`
- `DEFAULT_ROOT_PASSWORD`
- `CLIENT_ORIGIN`
- `COOKIE_SECURE=true`
- `TRUST_PROXY=true` وقتی برنامه پشت reverse proxy مطمئن قرار دارد
- `RESET_ROOT_PASSWORD_ON_BOOT=false`

ساخت و اجرا:

```bash
docker compose up -d --build
```

بررسی وضعیت:

```bash
docker compose ps
curl -H "X-Forwarded-Proto: https" http://127.0.0.1:3005/health
```

در حالت پیش‌فرض، پورت برنامه فقط روی localhost bind می‌شود. برای استفاده عمومی، Nexus Messenger را پشت یک reverse proxy با HTTPS مثل Nginx یا Caddy قرار دهید.

اجرای migration برای دیتابیس‌های موجود:

```bash
docker compose --profile migrate run --rm migrate
```

ولوم‌های تازه Docker از `backend/sql/init.sql` ساخته می‌شوند؛ migrationها برای دیتابیس‌های موجود هستند.

## فایل‌های محیطی

از فایل‌های نمونه استفاده کنید:

- `.env.example` برای تنظیمات production/runtime با Docker Compose
- `.env.docker.example` به عنوان نمونه جایگزین Docker
- `backend/.env.example` برای توسعه بک‌اند

هرگز فایل واقعی `.env` را commit نکنید. فایل‌های نمونه فقط مقدارهای placeholder دارند.

## نکات امنیتی قبل از استفاده عمومی

- secretها و رمزهای دیتابیس را قوی و یکتا تنظیم کنید.
- فایل `.env`، توکن‌ها، کلیدهای خصوصی، dump دیتابیس و فایل‌های آپلود شده را commit نکنید.
- در production از HTTPS و reverse proxy مطمئن استفاده کنید.
- uploadها، storage و backupها را متناسب با نیاز deployment خصوصی نگه دارید.
- از داده‌های PostgreSQL، Redis در صورت نیاز، و فایل‌های storage بکاپ بگیرید.
- پورت‌های باز را بررسی کنید؛ تنظیم پیش‌فرض Compose پورت‌های برنامه، PostgreSQL و Redis را به localhost محدود می‌کند.
- وابستگی‌ها و imageهای پایه را به‌روز نگه دارید.
- در production مقدار `RESET_ROOT_PASSWORD_ON_BOOT=false` باشد.
- link preview را فقط وقتی فعال کنید که واقعا می‌خواهید سرور درخواست HTTP خارجی ارسال کند.

## محدودیت‌های فعلی

- رمزنگاری end-to-end در نسخه 1.0.0 وجود ندارد.
- آواتارهای کاربر و گروه در این نسخه به صورت عمومی سرو می‌شوند.
- رفتار عمومی مدیا/آواتار را قبل از انتشار اینترنتی با مدل تهدید خودتان بررسی کنید.
- ابزار نصب/CLI در نقشه راه آینده است؛ مسیر پشتیبانی‌شده نسخه 1.0.0 Docker Compose است.
- نسخه 1.0.0 اولین انتشار پایدار عمومی است، نه یک مجموعه پیام‌رسان سازمانی بالغ.
- smoke test بک‌اند محافظت‌شده است و به متغیرهای محیطی مشخص و دیتابیس disposable نیاز دارد.

## نقشه راه

- ابزار نصب خودکار/CLI
- بهبود خودکارسازی deployment
- بررسی امکان E2EE اختیاری
- ابزارهای مدیریتی و moderation بیشتر
- بهبود تجربه backup/restore

## لایسنس

MIT License  
Copyright (c) 2026 Ashin Team

</div>
