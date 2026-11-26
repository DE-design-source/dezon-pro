-- Kinh doanh: hội thoại ghi lại (0055) lưu thêm cờ "file ghi âm phủ trọn cuộc trò chuyện" do trình duyệt báo lúc tải lên
-- (audioComplete). Chạy lại AI (Phân tích lại / Thử lại) dùng cờ đã lưu: ghi âm không đủ -> AI làm từ bản chép trực tiếp.
-- Code: kd_ghi_am.am_thanh_du (db-map.json); module backend/internal/modules/sales (service_recording.go).
-- Kiểm tra trước: bảng sales_lead_recordings đã có, cột chưa có.
-- Quay lui: alter table sales_lead_recordings drop column audio_complete; (chạy lại AI lại coi mọi file ghi âm là đủ).

do $$ begin
  if to_regclass('public.sales_lead_recordings') is null then
    raise exception '0056: thiếu bảng sales_lead_recordings (chạy 0055 trước)';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'sales_lead_recordings' and column_name = 'audio_complete') then
    raise exception '0056: cột sales_lead_recordings.audio_complete đã có';
  end if;
end $$;

-- Dòng cũ nhận false: chạy lại AI cho hội thoại cũ dựa vào bản chép trực tiếp khi có (an toàn hơn coi file ghi âm là đủ).
alter table sales_lead_recordings add column audio_complete boolean not null default false;

comment on column sales_lead_recordings.audio_complete is 'true = the browser reported the audio file covers the whole conversation (AI transcribes from audio); false = partial or no audio (AI works from live_lines when present).';

-- Xác minh sau
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'sales_lead_recordings' and column_name = 'audio_complete') then
    raise exception '0056: chưa thêm được cột sales_lead_recordings.audio_complete';
  end if;
end $$;
