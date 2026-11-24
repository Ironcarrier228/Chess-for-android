# Android-сборка «Гамбит»

Здесь лежит нативная обёртка (Kotlin + WebView) вокруг приложения из корня
репозитория. Вся логика шахмат и тренера — в `app/src/main/assets/www`
(копия веб-версии, обновляется скриптом).

## Что нужно

- Android Studio (Ladybug или новее) **или** Android SDK + JDK 17
- Интернет только для первой загрузки Gradle/зависимостей

## Сборка

```bash
# 1) обновить веб-часть внутри проекта (после любых правок в src/ или index.html)
./scripts/sync-android.sh

# 2) собрать отладочный APK
cd android
./gradlew assembleDebug
# файл: app/build/outputs/apk/debug/app-debug.apk

# 3) установить на подключённый телефон
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Если `gradlew` ещё не сгенерирован, выполните в Android Studio
«Open project → android» — IDE создаст wrapper и скачает зависимости.
Или сгенерируйте wrapper вручную: `gradle wrapper --gradle-version 8.7`.

## Release-сборка

1. Создайте ключ:

```bash
keytool -genkeypair -v -keystore gambit.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias gambit
```

2. Добавьте в `~/.gradle/gradle.properties` (не в репозиторий!):

```properties
GAMBIT_STORE_FILE=/полный/путь/gambit.jks
GAMBIT_STORE_PASSWORD=...
GAMBIT_KEY_ALIAS=gambit
GAMBIT_KEY_PASSWORD=...
```

3. В `app/build.gradle.kts` замените `signingConfigs.getByName("debug")` на
   собственный `signingConfigs { create("release") { ... } }`,
   затем:

```bash
./gradlew bundleRelease     # AAB для Google Play
./gradlew assembleRelease   # APK для прямой установки
```

## Технические детали

- `minSdk 24`, `targetSdk 34`, Kotlin 2.0, AGP 8.5
- Приложение полностью офлайновое: интернет-разрешение не запрашивается,
  все файлы грузятся из `file:///android_asset/www/index.html`
- Тёмная тема, edge-to-edge, поддержка поворота экрана
- Кнопка «Назад» сначала закрывает внутренние шторки, потом выходит из игры
  (хуки `window.gambitCanGoBack` / `window.gambitGoBack`)

## Публикация в Google Play

1. `./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`
2. Play Console → создать приложение → загрузить AAB
3. Иконка 512×512 и скриншоты: `assets/icons/icon-512.png` + скриншоты экрана
4. Категория «Игры → Настольные», рейтинг 0+, политика конфиденциальности
   не требуется (приложение не собирает данные)
