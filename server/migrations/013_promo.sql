-- 013_promo.sql —— 推广位本机埋点表（设计稿-个人版推广位方案 §5.3）
-- 红线：promo_events 仅本机 SQLite 存储，永不外传；设置页可一键清空。
create table if not exists promo_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot TEXT NOT NULL,               -- 版位码 promo_sidebar_footer / promo_grid_native / promo_list_footer
  creative_id TEXT NOT NULL,        -- 白名单素材 id
  event TEXT NOT NULL check (event in ('impress','click','close','vip_pay')),
  mode TEXT NOT NULL DEFAULT '',    -- close 事件区分 once|vip，其余空串
  ts TEXT NOT NULL                  -- ISO 时间串（本机时区，展示口径与全库一致）
);
-- 频控查询热点：按素材+事件+时间窗计数近 7 天 impress
create index if not exists IX_promo_events_creative on promo_events(creative_id, event, ts);
