-- 012_item_org.sql —— 基础资料按组织隔离（请求G）：T_MD_Item 增 FORGID 归属列 + 组织维度唯一索引
-- 口径：全局字典类（MDOrg 组织字典本身 / MDUnit 计量单位 / MDCurrency 币别）不加组织、恒 FORGID=''（跨组织共用）；
--   其余类别新建服务端铸造 FORGID=当前组织、列表/下拉按 (FORGID='' OR FORGID=当前组织) 过滤（未分派旧数据任何组织可见）。
--   原全局唯一索引 (FItemType,FNumber) 改为组织内唯一 (FItemType,FNumber,FORGID)，允许不同组织同代码共存。
--   既存行 ALTER 后 FORGID 取默认 ''（视为未分派，全组织可见），不破坏历史数据与种子。
ALTER TABLE T_MD_Item ADD COLUMN FORGID TEXT DEFAULT '';
DROP INDEX idx_itemcode_active;
CREATE UNIQUE INDEX idx_itemcode_active ON T_MD_Item(FItemType, FNumber, FORGID) WHERE deleted_at IS NULL;
PRAGMA user_version = 12;
