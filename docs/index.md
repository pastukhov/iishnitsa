---
layout: default
title: Iishnitsa - AI Chat App
---

<div class="hero">
  <img src="{{ '/assets/images/icon.svg' | relative_url }}" alt="Iishnitsa Logo" class="hero-logo">
  <h1>Iishnitsa</h1>
  <p class="tagline">AI-чат с поддержкой множества провайдеров</p>
  <a href="{{ site.apk_download_url }}" class="download-btn">Скачать APK</a>
</div>

---

## Возможности

<div class="features">
  <div class="feature">
    <h3>Множество AI-провайдеров</h3>
    <p>Поддержка OpenAI, Anthropic, Together, Mistral, Perplexity, DeepSeek, Groq, Yandex и других провайдеров в одном приложении.</p>
  </div>

  <div class="feature">
    <h3>MCP-инструменты</h3>
    <p>Интеграция с Model Context Protocol для расширения возможностей AI через внешние инструменты.</p>
  </div>

  <div class="feature">
    <h3>Прикрепление изображений</h3>
    <p>Отправляйте изображения в чат для анализа мультимодальными моделями.</p>
  </div>

  <div class="feature">
    <h3>Темы оформления</h3>
    <p>Тёмная и светлая темы для комфортной работы в любых условиях.</p>
  </div>

  <div class="feature">
    <h3>Синхронизация промптов</h3>
    <p>Автоматическая загрузка промптов из репозитория awesome-ai-prompts.</p>
  </div>

  <div class="feature">
    <h3>Офлайн хранение</h3>
    <p>Все чаты и настройки сохраняются локально на устройстве.</p>
  </div>
</div>

---

## Поддерживаемые провайдеры

| Провайдер | API | Особенности |
|-----------|-----|-------------|
| OpenAI | ✅ | GPT-4, GPT-4o, o1 |
| Anthropic | ✅ | Claude 3.5, Claude 3 |
| Together | ✅ | Llama, Mixtral, и др. |
| Mistral | ✅ | Mistral Large, Medium |
| Perplexity | ✅ | Поиск + AI |
| DeepSeek | ✅ | DeepSeek V3, R1 |
| Groq | ✅ | Быстрый inference |
| Yandex | ✅ | YandexGPT |
| OpenRouter | ✅ | Агрегатор моделей |

---

## FAQ

<details>
<summary><strong>Что такое Iishnitsa?</strong></summary>
<p>Iishnitsa (Иишница) — это мобильное приложение для Android, которое позволяет общаться с различными AI-моделями через единый интерфейс. Вы можете использовать свои API-ключи от разных провайдеров.</p>
</details>

<details>
<summary><strong>Как настроить API-ключи?</strong></summary>
<p>Откройте настройки приложения (шестерёнка в боковом меню), выберите нужного провайдера и введите ваш API-ключ. Ключи хранятся только на вашем устройстве.</p>
</details>

<details>
<summary><strong>Что такое MCP?</strong></summary>
<p>Model Context Protocol — это протокол, позволяющий AI-моделям взаимодействовать с внешними инструментами и сервисами. Вы можете подключить MCP-серверы для расширения возможностей AI.</p>
</details>

<details>
<summary><strong>Приложение бесплатное?</strong></summary>
<p>Да, приложение полностью бесплатное и с открытым исходным кодом. Вам понадобятся только API-ключи от выбранных провайдеров (некоторые имеют бесплатные тарифы).</p>
</details>

---

## Установка

1. Скачайте APK файл по кнопке выше или из [GitHub Releases](https://github.com/pastukhov/iishnitsa/releases)
2. Разрешите установку из неизвестных источников в настройках Android
3. Установите приложение
4. Добавьте API-ключи в настройках

---

<div class="footer-links">
  <a href="https://github.com/pastukhov/iishnitsa">GitHub</a>
  <span>•</span>
  <a href="https://github.com/pastukhov/iishnitsa/issues">Сообщить о проблеме</a>
  <span>•</span>
  <span>Версия {{ site.app_version }}</span>
</div>
