-- 004_item.sql —— 个人版补齐模具基础资料页（item 页型）：模具类型 MDType / 模具部件分类 MDPartClass
-- 设计口径：企业 item 为「每个类别一张动态表 T_{FItemType}」（T_MDType/T_MDPartClass + T_Item/T_Itemprop 元数据），
-- 个人版精简为单张通用台账 T_MD_Item，用 FItemType 列区分类别（单人无组织/无自定义属性列/无多级分组树）。
-- 列名与契约字段对齐企业 selectItemData 输出键语义：FNumber=代码、FName=名称、FStatus(0启用/9禁用)、
-- FIsRoot(1组/0否，个人版恒 0)、FParentNumber=上级组代码（个人版恒 '0'）；FID=自增列（编辑/删除定位键）。
-- 软删部分唯一索引（坑 4 同 dp 子页）：同类型内代码活动记录唯一，删除后可同号重建。

CREATE TABLE T_MD_Item (
  FID INTEGER PRIMARY KEY AUTOINCREMENT,
  FItemType TEXT NOT NULL,                                -- 类别代码（MDType / MDPartClass）
  FNumber TEXT NOT NULL,                                  -- 代码（同类别活动记录内唯一）
  FName TEXT NOT NULL,                                    -- 名称
  FStatus INTEGER NOT NULL DEFAULT 0,                     -- 状态（0=启用 9=禁用，对齐企业 itemWriteQueries ban/enable）
  FIsRoot INTEGER NOT NULL DEFAULT 0,                     -- 是否组（1=是 0=否；个人版扁平台账恒 0）
  FParentNumber TEXT NOT NULL DEFAULT '0',                -- 上级组代码（个人版扁平台账恒 '0'）
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_itemcode_active ON T_MD_Item(FItemType, FNumber) WHERE deleted_at IS NULL;
CREATE INDEX idx_item_type ON T_MD_Item(FItemType) WHERE deleted_at IS NULL;
