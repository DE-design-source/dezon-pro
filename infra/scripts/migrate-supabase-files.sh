#!/usr/bin/env bash
# Chuyển ảnh / tài liệu còn nằm trên Supabase Storage (dự án cũ) về kho file của QS Pro (volume uploads, /files/...).
# Chạy TRÊN VPS, từ bất kỳ đâu (script tự vào infra/deploy):
#   bash infra/scripts/migrate-supabase-files.sh scan      # CHỈ ĐỌC: đếm link Supabase trong database, file nào đã có / còn thiếu trên VPS
#   bash infra/scripts/migrate-supabase-files.sh download  # tải file còn thiếu từ Supabase về volume uploads (Supabase phải mở lại)
#   bash infra/scripts/migrate-supabase-files.sh rewrite   # sao lưu database rồi đổi mọi link Supabase -> /files/<thư mục>/<tên file>
# Tên file giữ nguyên: https://<supa>/storage/v1/object/public/products/sp%2F123-456.jpg -> /files/sp/123-456.jpg
# Danh sách lưu ở WORK_DIR (mặc định /opt/qspro-backups/supabase-files): all.txt (mọi file từng thấy), co-san.txt, thieu.txt, loi-tai.txt.
set -euo pipefail

SUPA="https://xcjnpjpkmwhekkabpjzw.supabase.co/storage/v1/object/public/products"
SUPA_RE='https://xcjnpjpkmwhekkabpjzw\.supabase\.co/storage/v1/object/public/products/([a-z]+)(?:%2F|/)'
WORK="${WORK_DIR:-/opt/qspro-backups/supabase-files}"
MODE="${1:-scan}"

cd "$(dirname "${BASH_SOURCE[0]}")/../deploy"
mkdir -p "$WORK"
psql_() { docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' psql "$@"; }

VOL="$(docker volume inspect qspro_uploads -f '{{.Mountpoint}}')"
[ -d "$VOL" ] || { echo "LỖI: không thấy volume qspro_uploads" >&2; exit 1; }
urldecode() { local s="${1//+/ }"; printf '%b' "${s//%/\\x}"; }

scan() {
  # Mọi cột text / varchar / json / jsonb của mọi bảng public: lấy <thư mục>/<tên file> trong link Supabase
  psql_ -At <<SQL | sed '/^$/d' | sort -u > "$WORK/db-now.txt"
SELECT format(\$q\$SELECT DISTINCT m[1] || '/' || m[2] FROM public.%I, regexp_matches(%I::text, %L, 'g') m WHERE %I::text LIKE '%%supabase.co/storage%%'\$q\$,
    c.table_name, c.column_name, '${SUPA_RE}([A-Za-z0-9._%-]+)', c.column_name)
  FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
  WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.is_generated = 'NEVER'
    AND c.data_type IN ('text', 'character varying', 'json', 'jsonb') \gexec
SQL
  touch "$WORK/all.txt"
  sort -u "$WORK/all.txt" "$WORK/db-now.txt" -o "$WORK/all.txt"
  : > "$WORK/co-san.txt"; : > "$WORK/thieu.txt"
  while IFS= read -r p; do
    if [ -s "$VOL/$(urldecode "$p")" ]; then echo "$p" >> "$WORK/co-san.txt"; else echo "$p" >> "$WORK/thieu.txt"; fi
  done < "$WORK/all.txt"
  echo "Link Supabase còn trong database: $(wc -l < "$WORK/db-now.txt") file"
  echo "Tổng file cần có (all.txt):       $(wc -l < "$WORK/all.txt")"
  echo "  đã có trên VPS (co-san.txt):    $(wc -l < "$WORK/co-san.txt")"
  echo "  còn thiếu (thieu.txt):          $(wc -l < "$WORK/thieu.txt")"
  local p1; p1="$(head -n 1 "$WORK/thieu.txt" || true)"
  if [ -n "$p1" ]; then
    local d="${p1%%/*}" n="${p1#*/}"
    echo "Thử tải từ Supabase: HTTP $(curl -s -o /dev/null -m 20 -w '%{http_code}' "$SUPA/$d%2F$n") (200 = đã mở lại, 402 = vẫn bị khoá)"
  fi
  df -h "$VOL" | tail -n 1 | awk '{print "Ổ đĩa còn trống: " $4 " (" $5 " đã dùng)"}'
}

download() {
  scan
  [ -s "$WORK/thieu.txt" ] || { echo "Không còn file nào thiếu."; return; }
  local free; free="$(df -Pk "$VOL" | awk 'NR==2{print $4}')"
  [ "$free" -gt 2097152 ] || { echo "LỖI: ổ còn dưới 2 GB, dọn /opt/qspro-backups trước" >&2; exit 1; }
  local ok=0 bad=0 own; own="$(stat -c '%u:%g' "$VOL")"
  : > "$WORK/loi-tai.txt"
  while IFS= read -r p; do
    local d="${p%%/*}" n="${p#*/}" f; f="$VOL/$(urldecode "$p")"
    mkdir -p "$(dirname "$f")"
    if curl -sf -m 120 --retry 2 -o "$f.tmp" "$SUPA/$d%2F$n" && [ -s "$f.tmp" ]; then
      mv "$f.tmp" "$f"; chown "$own" "$f" "$(dirname "$f")"; ok=$((ok + 1))
    else
      rm -f "$f.tmp"; echo "$p" >> "$WORK/loi-tai.txt"; bad=$((bad + 1))
    fi
    [ $(((ok + bad) % 100)) -eq 0 ] && echo "  ... $((ok + bad)) file (lỗi $bad)"
  done < "$WORK/thieu.txt"
  echo "Tải xong: $ok file, lỗi $bad (danh sách: $WORK/loi-tai.txt)"
  [ "$bad" -eq 0 ] || echo "Supabase còn khoá (402) thì mọi file đều lỗi: mở lại Supabase rồi chạy lại download."
}

rewrite() {
  scan   # ghi all.txt trước khi đổi link, để download sau này vẫn biết file nào cần tải
  echo "Sao lưu database trước khi sửa..."
  local out; out="$WORK/truoc-rewrite-$(date +%Y%m%d-%H%M%S).dump"
  docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$out"
  [ -s "$out" ] || { echo "LỖI: bản sao lưu rỗng, dừng" >&2; exit 1; }
  echo "Đã sao lưu: $out"
  psql_ <<SQL
DO \$\$
DECLARE r record; n bigint; tot bigint := 0;
BEGIN
  FOR r IN SELECT c.table_name, c.column_name, c.data_type
           FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
           WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.is_generated = 'NEVER'
             AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
  LOOP
    EXECUTE format('UPDATE public.%I SET %I = regexp_replace(%I::text, %L, %L, %L)::%s WHERE %I::text LIKE %L',
      r.table_name, r.column_name, r.column_name, '${SUPA_RE}', '/files/\1/', 'g', r.data_type,
      r.column_name, '%supabase.co/storage%');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '%.%: % dòng', r.table_name, r.column_name, n; tot := tot + n; END IF;
  END LOOP;
  RAISE NOTICE 'Tổng: % dòng đã đổi link', tot;
END
\$\$;
SQL
  echo "Xong. Kiểm lại: bash $0 scan (dòng 'Link Supabase còn trong database' phải = 0)."
}

case "$MODE" in
  scan) scan ;;
  download) download ;;
  rewrite) rewrite ;;
  *) echo "Dùng: $0 scan | download | rewrite" >&2; exit 1 ;;
esac
