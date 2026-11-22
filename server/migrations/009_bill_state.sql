-- 009_bill_state.sql —— 单据状态（审核流）列
-- 2026-11-19 全链走查缺陷 A：个人版 /billstatus 审核/反审核被 p2a 时代能力裁剪硬拒，
--   「创建→审核→下推→记录」标准业务流在产品层断裂。审核态需要逐单据表落列：
--   单据类表 FStatus 已被业务枚举占用（如 T_MD_Repair.FStatus=处理状态），统一新增 FBillState
--   （语义对齐企业 FStatus：0创建/1已审核/6已关闭）；模具档案 203101 沿用建表即有的 FStatus
--   （企业同义整数列），仅把默认值 1（已审核）纠正为 0（创建）——审核此前从未开放，存量无已审核单。
-- 单据页清单由 db.js migrate 后置钩子按 PAGE_DEFS.billNoPrefix 权威枚举动态补列（档案类页不加）。
PRAGMA user_version = 9;
