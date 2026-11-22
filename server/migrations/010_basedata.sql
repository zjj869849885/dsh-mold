-- 010_basedata.sql —— 基础资料模块（请求D）：203101 模具档案 + 各单据页对齐企业版网页补列
-- 口径：全部 ALTER ADD COLUMN 加法扩展（新列默认值不受既存列默认值坑影响）；
-- 下拉列存台账「名称」文本（个人版 itemRef 同口径，历史文本值不迁移、进下拉即可命中）；
-- 班制 FShift / 工序 FOperNumber 企业源值表 0 行 → 个人版保持手工文本列。
-- item 类别种子由 db.js seedDefaults 逐类别独立幂等写入（不在此重复）。

-- 1. 模具档案 203101（对齐企业 203101 表头 48 列中个人可用列）
ALTER TABLE T_MD_Mould ADD COLUMN FBriefName TEXT DEFAULT '';            -- 模具简称
ALTER TABLE T_MD_Mould ADD COLUMN FSmallType TEXT DEFAULT '';            -- 模具组（itemRef MDMoldGroup）
ALTER TABLE T_MD_Mould ADD COLUMN FChkStatus TEXT DEFAULT '';            -- 验收状态（未验收/已验收）
ALTER TABLE T_MD_Mould ADD COLUMN FMDStockStatus TEXT DEFAULT '';        -- 库存状态（出库/在库）
ALTER TABLE T_MD_Mould ADD COLUMN FDept TEXT DEFAULT '';                 -- 所属车间（itemRef MDDept）
ALTER TABLE T_MD_Mould ADD COLUMN FProdLine TEXT DEFAULT '';             -- 生产中心（itemRef MDProdLine）
ALTER TABLE T_MD_Mould ADD COLUMN FStock TEXT DEFAULT '';                -- 存放仓库（itemRef MDStock）
ALTER TABLE T_MD_Mould ADD COLUMN FStorageLoc TEXT DEFAULT '';           -- 存放仓位（itemRef MDLocation）
ALTER TABLE T_MD_Mould ADD COLUMN FMainSche TEXT DEFAULT '';             -- 模具保养方案（文本，企业为方案下拉）
ALTER TABLE T_MD_Mould ADD COLUMN FCheckSche TEXT DEFAULT '';            -- 模具点检方案（文本，企业为方案下拉）
ALTER TABLE T_MD_Mould ADD COLUMN FMainRole TEXT DEFAULT '';             -- 保养人角色（itemRef MDPosition）
ALTER TABLE T_MD_Mould ADD COLUMN FCheckRole TEXT DEFAULT '';            -- 点检人角色（itemRef MDPosition）
ALTER TABLE T_MD_Mould ADD COLUMN FWeight REAL DEFAULT 0;                -- 模具重量
ALTER TABLE T_MD_Mould ADD COLUMN FWeightUnit TEXT DEFAULT '';           -- 重量单位（itemRef MDUnit）
ALTER TABLE T_MD_Mould ADD COLUMN FItemName TEXT DEFAULT '';             -- 适配原材料（文本）
ALTER TABLE T_MD_Mould ADD COLUMN FReceiverDate TEXT DEFAULT '';         -- 接收日期
ALTER TABLE T_MD_Mould ADD COLUMN FEnableDate TEXT DEFAULT '';           -- 启用日期
ALTER TABLE T_MD_Mould ADD COLUMN FScrapDate TEXT DEFAULT '';            -- 报废日期
ALTER TABLE T_MD_Mould ADD COLUMN FMDChargeDate TEXT DEFAULT '';         -- 模具变更时间
ALTER TABLE T_MD_Mould ADD COLUMN FSupplier TEXT DEFAULT '';             -- 供应商（itemRef MDSupplier）
ALTER TABLE T_MD_Mould ADD COLUMN FCust TEXT DEFAULT '';                 -- 客户（itemRef MDCustomer）
ALTER TABLE T_MD_Mould ADD COLUMN FBeforeENGR TEXT DEFAULT '';           -- 工程更改前号
ALTER TABLE T_MD_Mould ADD COLUMN FAdaptedType TEXT DEFAULT '';          -- 标准适配机型
ALTER TABLE T_MD_Mould ADD COLUMN FCycle REAL DEFAULT 0;                 -- 标准周期(S)
ALTER TABLE T_MD_Mould ADD COLUMN FDESCY REAL DEFAULT 0;                 -- 设计产能8H
ALTER TABLE T_MD_Mould ADD COLUMN FLevelCY REAL DEFAULT 0;               -- 标准产能8H
ALTER TABLE T_MD_Mould ADD COLUMN FUsableCavity INTEGER DEFAULT 0;       -- 可用穴数
ALTER TABLE T_MD_Mould ADD COLUMN FLifeWarn INTEGER DEFAULT 0;           -- 寿命报警线
ALTER TABLE T_MD_Mould ADD COLUMN FRemainLifeQty INTEGER DEFAULT 0;      -- 剩余寿命
ALTER TABLE T_MD_Mould ADD COLUMN FMDCost REAL DEFAULT 0;                -- 模具金额

-- 2. 部件档案 203102
ALTER TABLE T_MD_Part ADD COLUMN FSupplier TEXT DEFAULT '';              -- 供应商（企业部件表体同名列）
ALTER TABLE T_MD_Part ADD COLUMN FPartClass TEXT DEFAULT '';             -- 部件分类（itemRef MDPartClass）

-- 3. 备件档案 203103
ALTER TABLE T_MD_Spare ADD COLUMN FSupplier TEXT DEFAULT '';             -- 供应商（itemRef MDSupplier）

-- 4. 点检/保养方案：适用机台（企业生产中心列，源空退文本亦可手录）
ALTER TABLE T_MD_ChkSched ADD COLUMN FMach TEXT DEFAULT '';              -- 适用机台(生产中心)
ALTER TABLE T_MD_MainSched ADD COLUMN FMach TEXT DEFAULT '';             -- 适用机台(生产中心)

-- 5. 点检任务单 203114
ALTER TABLE T_MD_CheckTask ADD COLUMN FScheName TEXT DEFAULT '';         -- 点检方案名称（attach 带出）
ALTER TABLE T_MD_CheckTask ADD COLUMN FMouldName TEXT DEFAULT '';        -- 模具名称（attach 带出）
ALTER TABLE T_MD_CheckTask ADD COLUMN FReceiverEmp TEXT DEFAULT '';      -- 接收人（itemRef MDEmployee）
ALTER TABLE T_MD_CheckTask ADD COLUMN FShift TEXT DEFAULT '';            -- 班制（企业源空=文本）
ALTER TABLE T_MD_CheckTask ADD COLUMN FOperNumber TEXT DEFAULT '';       -- 工序编码（企业源空=文本）
ALTER TABLE T_MD_CheckTask ADD COLUMN FWorkNo TEXT DEFAULT '';           -- 派工单号
ALTER TABLE T_MD_CheckTaskEntry ADD COLUMN FChkStandard TEXT DEFAULT ''; -- 点检标准（企业 B1 标准/极限值旁列）

-- 6. 点检记录 203116（FDuration 既存 TEXT 列承载数值文本，不改列型——SQLite 改型需重建表，超红线）
ALTER TABLE T_MD_CheckRecord ADD COLUMN FOperatEmp TEXT DEFAULT '';      -- 处理人（企业列名，替代旧 FHandler 语义）
ALTER TABLE T_MD_CheckRecord ADD COLUMN FReceiverEmp TEXT DEFAULT '';    -- 接收人（itemRef MDEmployee）
ALTER TABLE T_MD_CheckRecord ADD COLUMN FShift TEXT DEFAULT '';          -- 班制（文本）

-- 7. 保养任务单 203124
ALTER TABLE T_MD_MainTask ADD COLUMN FScheName TEXT DEFAULT '';          -- 保养方案名称（attach 带出）
ALTER TABLE T_MD_MainTask ADD COLUMN FMouldName TEXT DEFAULT '';         -- 模具名称（attach 带出）
ALTER TABLE T_MD_MainTask ADD COLUMN FReceiverEmp TEXT DEFAULT '';       -- 接收人（itemRef MDEmployee）
ALTER TABLE T_MD_MainTask ADD COLUMN FShift TEXT DEFAULT '';             -- 班制（文本）
ALTER TABLE T_MD_MainTask ADD COLUMN FOperNumber TEXT DEFAULT '';        -- 工序编码（文本）
ALTER TABLE T_MD_MainTask ADD COLUMN FWorkNo TEXT DEFAULT '';            -- 派工单号

-- 8. 保养记录 203126
ALTER TABLE T_MD_MainRecord ADD COLUMN FOperatEmp TEXT DEFAULT '';       -- 处理人（企业列名）
ALTER TABLE T_MD_MainRecord ADD COLUMN FReceiverEmp TEXT DEFAULT '';     -- 接收人（itemRef MDEmployee）
ALTER TABLE T_MD_MainRecord ADD COLUMN FShift TEXT DEFAULT '';           -- 班制（文本）

-- 9. 报修单 203130
ALTER TABLE T_MD_Repair ADD COLUMN FRPTRepairerEmp TEXT DEFAULT '';      -- 报修人（企业列名，旧 FReporter 列保留不动）
ALTER TABLE T_MD_Repair ADD COLUMN FFaultLevel TEXT DEFAULT '';          -- 故障级别（一级/二级/三级故障）
ALTER TABLE T_MD_Repair ADD COLUMN FScType TEXT DEFAULT '';              -- 来源类型（生产异常/点检异常）

-- 10. 维修任务单 203131（FReceiverEmp 新列承接企业列名，旧 FHandler 保留）
ALTER TABLE T_MD_ServerTask ADD COLUMN FReceiverEmp TEXT DEFAULT '';     -- 接收人（itemRef MDEmployee）
ALTER TABLE T_MD_ServerTask ADD COLUMN FServerType TEXT DEFAULT '';      -- 维修类型（外部/内部类型）
ALTER TABLE T_MD_ServerTask ADD COLUMN FServerUnit TEXT DEFAULT '';      -- 维修单位（itemRef MDSupplier）
ALTER TABLE T_MD_ServerTask ADD COLUMN FContactEmp TEXT DEFAULT '';      -- 联系人（文本）
ALTER TABLE T_MD_ServerTask ADD COLUMN FContactWay TEXT DEFAULT '';      -- 联系方式（文本）
ALTER TABLE T_MD_ServerTask ADD COLUMN FShift TEXT DEFAULT '';           -- 班制（文本）
ALTER TABLE T_MD_ServerTask ADD COLUMN FOperNumber TEXT DEFAULT '';      -- 工序编码（文本）
ALTER TABLE T_MD_ServerTask ADD COLUMN FWorkNo TEXT DEFAULT '';          -- 派工单号

-- 11. 维修记录 203133（表头 + B1 领用记录）
ALTER TABLE T_MD_Server ADD COLUMN FServerType TEXT DEFAULT '';          -- 维修类型（外部/内部类型）
ALTER TABLE T_MD_Server ADD COLUMN FReversoContext TEXT DEFAULT '';      -- 故障原因（企业 6 值枚举）
ALTER TABLE T_MD_Server ADD COLUMN FRPTRepairerEmp TEXT DEFAULT '';      -- 报修人（itemRef MDEmployee）
ALTER TABLE T_MD_Server ADD COLUMN FOperatEmp TEXT DEFAULT '';           -- 处理人（itemRef MDEmployee）
ALTER TABLE T_MD_ServerEntry ADD COLUMN FStock TEXT DEFAULT '';          -- 领用仓库（itemRef MDStock）
ALTER TABLE T_MD_ServerEntry ADD COLUMN FStorageLoc TEXT DEFAULT '';     -- 领用仓位（itemRef MDLocation）
ALTER TABLE T_MD_ServerEntry ADD COLUMN FPickEmp TEXT DEFAULT '';        -- 领用人（itemRef MDEmployee）

-- 12. 生产申领单 203140（表头 + B1）
ALTER TABLE T_MD_PordApply ADD COLUMN FBillType TEXT DEFAULT '';         -- 单据类型（生产/维修/保养/出厂/归还）
ALTER TABLE T_MD_PordApplyEntry ADD COLUMN FStock TEXT DEFAULT '';       -- 存放仓库（itemRef MDStock）
ALTER TABLE T_MD_PordApplyEntry ADD COLUMN FStorageLoc TEXT DEFAULT '';  -- 存放仓位（itemRef MDLocation）
ALTER TABLE T_MD_PordApplyEntry ADD COLUMN FMach TEXT DEFAULT '';        -- 申领机台(生产中心)
ALTER TABLE T_MD_PordApplyEntry ADD COLUMN FShift TEXT DEFAULT '';       -- 班制（文本）

-- 13. 出库申请单 203141（表头 + B1）
ALTER TABLE T_MD_OutboundApply ADD COLUMN FBiiType TEXT DEFAULT '';      -- 单据类型（企业 203141 列名 FBiiType）
ALTER TABLE T_MD_OutboundApplyEntry ADD COLUMN FStock TEXT DEFAULT '';   -- 存放仓库（itemRef MDStock）
ALTER TABLE T_MD_OutboundApplyEntry ADD COLUMN FStorageLoc TEXT DEFAULT ''; -- 存放仓位（itemRef MDLocation）
ALTER TABLE T_MD_OutboundApplyEntry ADD COLUMN FMach TEXT DEFAULT '';    -- 申领机台(生产中心)
ALTER TABLE T_MD_OutboundApplyEntry ADD COLUMN FShift TEXT DEFAULT '';   -- 班制（文本）

-- 14. 领用记录单 203142（表头 + B1）
ALTER TABLE T_MD_PickRecord ADD COLUMN FBiiType TEXT DEFAULT '';         -- 单据类型
ALTER TABLE T_MD_PickRecordEntry ADD COLUMN FStock TEXT DEFAULT '';      -- 存放仓库（itemRef MDStock）
ALTER TABLE T_MD_PickRecordEntry ADD COLUMN FStorageLoc TEXT DEFAULT ''; -- 存放仓位（itemRef MDLocation）
ALTER TABLE T_MD_PickRecordEntry ADD COLUMN FMach TEXT DEFAULT '';       -- 申领机台(生产中心)
ALTER TABLE T_MD_PickRecordEntry ADD COLUMN FShift TEXT DEFAULT '';      -- 班制（文本）

-- 15. 归还记录单 203143（表体页 table 名以 PAGE_DEFS 为准：T_MD_ReturnRecordEntry）
ALTER TABLE T_MD_ReturnRecordEntry ADD COLUMN FMach TEXT DEFAULT '';     -- 申领机台(生产中心)
ALTER TABLE T_MD_ReturnRecordEntry ADD COLUMN FShift TEXT DEFAULT '';    -- 班制（文本）

-- 16. 报废单 203146
ALTER TABLE T_MD_Scrap ADD COLUMN FBillType TEXT DEFAULT '';             -- 单据类型

-- 17. 盘点记录单 203151 表体：存放地点接库位台账（FPosition 列既存，仅语义升级，无 ALTER）

PRAGMA user_version = 10;
