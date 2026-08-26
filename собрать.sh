#!/bin/bash
#
# Собирает оба приложения проекта и вписывает в них путь к папке.
#
# ── Зачем этот скрипт вообще ──
#
# Приложениям нужно знать, где лежит проект, а узнать это самим они не могут:
# копия «Сводки» живёт в /Applications, вдали от папки. Раньше путь был просто
# вписан в исходники — и вместе с ним в репозиторий уехала бы чужая домашняя
# папка с именем пользователя.
#
# Теперь путь вычисляется ЗДЕСЬ, из расположения самого скрипта, и вписывается
# при сборке. В исходниках его нет.
#
# ── Запуск ──
#     ./собрать.sh
#
# Пересобирать надо после каждой правки .applescript или .swift: правка
# исходника сама по себе ничего не меняет, пока приложение не пересобрано.
# На этом уже спотыкались дважды.
#
# Переменные названы ЛАТИНИЦЕЙ намеренно: оболочка русские имена
# не принимает вовсе и считает строку `ИМЯ=значение` попыткой запустить
# программу с таким именем. Ровно как AppleScript. Поймано при первом
# же запуске этого скрипта.

set -e
PROJ="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJ"
TMPDIR_="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_"' EXIT

echo "Проект: $PROJ"
echo

# ── Напоминалка ───────────────────────────────────────────────
#
# Путь ей не нужен: она лежит внутри папки и находит её через `path to me`.
#
# Собираем во временное место и переносим внутрь ТОЛЬКО скрипт. Прямая
# сборка поверх стёрла бы Info.plist, где накоплены три вещи, каждая
# из которых чинила отдельную поломку: свой идентификатор (иначе нет
# строчки в настройках уведомлений), тип ссылок napominalka:// (иначе
# не работают кнопки на странице) и LSUIElement (иначе окно перекидывает
# на другой рабочий стол).
if [ -d "Напоминалка.app" ] && [ -f 07-напоминалка.applescript ]; then
  echo "→ Напоминалка"
  osacompile -o "$TMPDIR_/Напоминалка.app" 07-напоминалка.applescript
  cp "$TMPDIR_/Напоминалка.app/Contents/Resources/Scripts/main.scpt" \
     "Напоминалка.app/Contents/Resources/Scripts/main.scpt"
  codesign --force --deep -s - "Напоминалка.app" 2>/dev/null
  echo "  собрана, Info.plist не тронут"
else
  echo "→ Напоминалка пропущена (нет .app или исходника)"
fi

# ── Сводка ────────────────────────────────────────────────────
#
# Настоящая программа на Swift, окно рисует WKWebView. Путь вписывается
# в Info.plist ключом «ПутьПроекта», оттуда его и читает 16-сводка.swift.
if command -v swiftc >/dev/null; then
  echo "→ Сводка"
  mkdir -p "Сводка.app/Contents/MacOS"
  cat > "Сводка.app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>Сводка</string>
    <key>CFBundleIdentifier</key><string>com.artem.svodka</string>
    <key>CFBundleName</key><string>Сводка</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>ПутьПроекта</key><string>$PROJ</string>
</dict>
</plist>
PLIST
  swiftc -O -o "Сводка.app/Contents/MacOS/Сводка" 16-сводка.swift
  codesign --force -s - "Сводка.app" 2>/dev/null
  echo "  собрана, путь вписан в Info.plist"

  # Копия в /Applications: «Быстрые команды» показывают только программы
  # оттуда, значит только так на окно можно повесить горячую клавишу.
  if [ -d "/Applications/Сводка.app" ]; then
    rm -rf "/Applications/Сводка.app"
    cp -R "Сводка.app" /Applications/
    echo "  копия в /Applications обновлена"
  fi
else
  echo "→ swiftc не найден, Сводку пропускаю (нужны инструменты разработчика)"
fi

# ── Проверить сейчас ──────────────────────────────────────────
#
# Приложение удалено 14 августа: ручной запуск переехал на долгое нажатие
# кнопки «обновить». Исходник оставлен, поэтому собираем, только если
# приложение уже существует.
if [ -d "Проверить сейчас.app" ] && [ -f 09-проверить-сейчас.applescript ]; then
  echo "→ Проверить сейчас"
  # Заглушка называется ПУТЬ_ПРОЕКТА — ровно так, как в исходнике.
  #
  # Здесь была опечатка «ПУТЬ_PROJА»: массовая замена «ПРОЕКТ» на «PROJ»
  # (переменные оболочки должны быть латиницей) залезла и внутрь этого
  # слова. Получилась смесь латиницы с кириллицей, на глаз неотличимая,
  # и подстановка молча не срабатывала. Не стреляло только потому,
  # что вся ветка выполняется лишь при существующем приложении.
  sed "s|ПУТЬ_ПРОЕКТА|$PROJ|" 09-проверить-сейчас.applescript > "$TMPDIR_/проверить.applescript"
  osacompile -o "$TMPDIR_/Проверить сейчас.app" "$TMPDIR_/проверить.applescript"
  cp "$TMPDIR_/Проверить сейчас.app/Contents/Resources/Scripts/main.scpt" \
     "Проверить сейчас.app/Contents/Resources/Scripts/main.scpt"
  codesign --force --deep -s - "Проверить сейчас.app" 2>/dev/null
  echo "  собрана"
fi

echo
echo "Готово."
