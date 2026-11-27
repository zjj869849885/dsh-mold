# AI模具管理（DeepSeek Harness 插件）

单文件本地版模具管理：数据落在本机 SQLite，**零外部依赖**（无需 SQL Server、无需外部网关），断网可用。

## 功能模块总览

侧栏共 9 个分组、52 张页面（22 单据 + 16 基础资料 + 14 报表），覆盖模具从建档、点检、保养、维修到领用归还、报废、盘点的全生命周期。

### 基础资料（16）
模具类型、模具部件分类、库位、模具组、供应商、客户、车间/部门、生产中心、仓库、人员、计量单位、币别、岗位/角色、点检项目类型、保养项目类型、组织——各类单据下拉的数据源。其中「组织」是数据源头，需先维护才能做单（见「关键约定」）。

### 模具管理（3）
- **模具档案**：模具主档，登记编号、名称、所属、状态、供应商、存放位置等，是全链路引用的根。
- **部件档案**：模具的部件构成，关联所属模具、规格、更换周期与状态。
- **备件档案**：可更换备件台账，供维修、保养、物资使用记录带出编码、名称、单位。

### 点检管理（基础资料 2 + 执行 2）
- **点检项目 / 点检方案**：定义点检内容与判定标准（基础资料）。
- **点检任务单**：按方案排出的待执行点检任务。
- **点检记录**：点检执行结果，含「点检记录项目」「物资使用记录」两个表体页签。

### 保养管理（基础资料 2 + 执行 2）
- **保养项目 / 保养方案**：定义保养内容与标准。
- **保养任务单**：按方案排出的保养任务。
- **保养记录**：保养执行结果，含「保养记录项目」「物资使用记录」两个表体页签。

### 维修管理（3）
- **报修单**：故障报修登记。
- **维修任务单**：派工维修任务。
- **维修记录**：维修处理结果，含「部件领用记录」表体。

### 业务处理（8）
生产申领单、出库申请单、领用记录单、归还记录单、报废单、使用汇报单、盘点记录单、状态变更单——覆盖模具与备件的领用、归还、报废、盘点及状态流转。

### 报表分析（14）
点检报表、保养报表、报修报表、维修报表、领用报表、归还报表、寿命报表、日常业务处理记录、故障次数统计、保养执行报表、人员任务统计、报废预测、使用情况统计、模具履历——多维度统计与全程追溯。

### AI 助手（个人版）
- **AI 悬浮球**：页面右下角悬浮球入口，点击打开模具数据分析弹窗（状态分布、点检/保养到期、待审积压等），数据实时取自本机台账。
- **问问 AI**：默认本地规则问答、零外网请求；可选直连本地 OpenAI 兼容模型（如 Ollama，本地端口 11434，默认关闭），数据不出机。
- **联系咨询**：免费版提示条与「联系咨询」弹窗提供升级/定制电话 400-110-8910（一键复制）与问题反馈微信二维码。

## 运行前提

| 项 | 要求 | 说明 |
|---|---|---|
| DeepSeek Harness（宿主） | 已安装 | 插件不自己监听端口，HTTP 由宿主持有 |
| Node.js | ≥ 22.13（推荐 24.x） | 数据层用内置 `node:sqlite`（`DatabaseSync`）；开发验证版本 v24.18 |
| 外部 npm 依赖 | 无 | `package.json` 的 `dependencies` 为空对象 |

## 关键约定

- **路由前缀**：`/m10-mold-personal/api/*`
- **数据目录**：`~/.m10-mold-personal`，优先级为 `cordis.patch.yml` 的 `config.dataDir` > 环境变量 `M10_PERSONAL_DATADIR` > 默认值
- **首启行为**：自动建 `dataDir/{images,backups}` → 迁移建库 → 幂等灌默认基础资料（OOBE）：15 类共 45 行台账（模具类型/部件分类/存放仓位/点检项类型/保养项类型/供应商/客户/部门/生产中心/仓库/人员/计量单位/币别/岗位/模具组）+ 4 类字典项。**不含业务单据与模具档案**
- **做单前必须先建组织**：组织台账（`MDOrg`）**故意不播种**——组织是数据源头，需你在「基础资料 → 组织」自行维护。未维护时任何单据的保存都会被服务端门禁拒回，提示「组织数据源未维护：请先在『基础资料 - 组织』中维护组织，维护后才能做单」（基础资料本身不受此门禁影响，所以不会死锁）
- **示例数据开关（默认关）**：`cordis.patch.yml` 的 `config.sampleMolds: true` 会在模具台账为空时自动插一条 `SAMPLE-001 示例模具（可删除）`；不写该项则仅有基础资料、无示例模具
- **数据与包解耦**：升级/重装插件不丢数据；备份 = 直接拷贝 `mold-personal.db`；重置 = 删除 `dataDir`
- **面板标识**：侧栏面板 id = `m10-mold-personal`，`moduleKey` = `mold`

## 安装方式怎么选

| 方式 | 适用 | 前提 |
|---|---|---|
| **A：npm 安装** | IDE 插件市场 / 命令行一键安装 | 已发布 npm 包，能访问 registry.npmjs.org |
| **B：插件页贴 GitHub 地址** | 需要直接跟随仓库源码 | 目标机能连 github.com |
| **C：插件页填本地路径** | 内网机 / 离线交付 | 先把仓库放到本机某目录 |
| **D：手改 profile** | 宿主是源码仓形态、或要批量部署 | 见下文 |

## 方式 A：npm 安装（IDE 插件市场推荐）

在 Harness「插件市场」搜索 `dsh-mold` 或完整包名 `dsh-plugin-m10-mold-personal`，点击安装；也可以执行：

```powershell
dsh plugin --profile web add dsh-plugin-m10-mold-personal
```

`web` 换成本机实际使用的 profile 名；浏览器版通常是 `web`，桌面版通常是 `desktop` 或 `desktop-NNN`。安装后按提示重启实例，侧栏出现「AI模具管理」面板。

## 方式 B：Harness「插件」页直接贴 GitHub 地址

1. 打开 Harness →「插件」→「添加插件」，安装源填：

   ```
   https://github.com/zjj869849885/dsh-mold.git
   ```

   等价写法：`github:zjj869849885/dsh-mold`。要锁版本就在末尾加 `#` 和 tag / 分支 / commit：

   ```
   https://github.com/zjj869849885/dsh-mold.git#v0.2.11
   ```

2. 确认。宿主对 git 地址**不做包内容预检**，直接把整个仓库交给 pnpm；pnpm 读的是**仓库根的 `package.json`**——这正是本仓摊平成「根即插件包」的原因。
3. 装完宿主会自己校验 `dsh.bundle` 声明、加载 `cordis.patch.yml`、把包名写进当前 profile 的 `bundles` 并启用，**不需要你手改任何配置文件**。
4. 列表里若提示需重启，重启实例后侧栏出现「AI模具管理」面板，按「第一次上手」建组织即可。

本仓为公开仓库，正常无需额外 GitHub 凭据。若安装失败，先验证网络与仓库可达：

```powershell
git ls-remote https://github.com/zjj869849885/dsh-mold.git
```

## 方式 C：插件页填本地路径

「添加插件」里填**绝对路径**，指向 clone/解压目录根即可：

```
D:/dsh-plugins/dsh-mold
```

宿主对本地路径会真检查：该目录必须有 `package.json` 且声明 `dsh.bundle`，否则回一句 `declares no dsh.bundle` 拒掉——摊平后根上就是插件包，能过。相对路径不接受。后续动作与方式 B 的第 3、4 步相同。

## 方式 D：安装：接到你手上的 Harness（手动配 profile）

1. 把本仓（摊平后的目录根）放到目标机的固定位置，例如 `D:/dsh-plugins/m10-mold-personal`（路径中不要带中文/空格更稳）。

2. 编辑 `personal` profile 的 `package.json`（路径为 `%USERPROFILE%/.dsh/profiles/personal/package.json`），把 `link:` 指向上一步的目录，并把包名加进 `bundles`：

   ```json
   {
     "dependencies": {
       "dsh-plugin-m10-mold-personal": "link:D:/dsh-plugins/m10-mold-personal"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "dsh-plugin-m10-mold-personal"
         ]
       }
     }
   }
   ```

   没有 `personal` 这个 profile 目录时，新建一个同名目录并放上述 `package.json` 即可（`--profile personal` 按目录名解析）。

3. **用宿主自带的 pnpm 安装**（全局 pnpm 版本不一致会失败）；宿主若是源码仓形态，在其仓库根（即 `<宿主目录>`，例你本机 clone 的位置）执行：

   ```powershell
   & '<宿主目录>/node_modules/.bin/pnpm.cmd' install
   ```

   注意：插件目录内**绝不要**裸跑 `npm install`。

4. 起实例（工作目录 = 宿主仓库根）：

   ```powershell
   & 'C:\Program Files\nodejs\node.exe' --import tsx/esm apps/cli/src/bin.ts `
     --profile personal --no-open `
     --host <本机局域网IP> --port 3081 --trusted-host <本机局域网IP>:3081
   ```

   `--host` 换成本机局域网 IP；宿主只绑该地址，所以用 `127.0.0.1` 探测端口会误判为未启动。

5. 启动日志里会打印一行 `dsh web: http://<ip>:<port>/?token=...`，直接打开即进入（token 由宿主签发）。手机同 Wi-Fi 时可打开同一地址访问。

### 两个必踩的坑（照做即可避开）

- `cordis.patch.yml` 里的 `name` **必须是包名** `dsh-plugin-m10-mold-personal`，不能写成 `file:///` 路径——否则客户端 bundle 会被静默跳过，页面外壳起来了但插件不加载。
- 改了 `cordis.patch.yml` 或 profile 的 `bundles`/`link:`，**必须重启实例**才生效；只改 `client.js` 磁盘产物则浏览器硬刷新即可。

## 方式 D 补充：从零在新机上手（详细版）

> 能连外网的机器直接走上面的「方式 A」或「方式 B」，本节 1~4 步全部跳过（宿主自己完成）；本节主要给不能装凭据、需要手动配 profile 的场景。

前提只三条：**目标机已装 Harness** ＋ **Node ≥ 22.13** ＋ **能读到本仓**。插件本体零依赖，不需要 npm 下载任何东西。

> 关键认识：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 是 Harness 自带的 bundle（随宿主安装器或宿主源码仓就位），**不要单独去 npm 安装它们**。本仓只负责往 profile 里多加一个 `dsh-plugin-m10-mold-personal`。

1. **取包**（二选一）

   ```powershell
   git clone https://github.com/zjj869849885/dsh-mold.git
   ```

   或者直接发压缩包：把仓库根目录（摊平后就是插件包本体）打 zip 传过去解压（包体零依赖，离线传输完全可行）。

2. **放固定位置**：例如 `D:/dsh-plugins/m10-mold-personal`（路径不要带中文/空格）。放好后该目录下应直接能看到 `package.json` 与 `server/`。

3. **建/改 profile**：路径 `%USERPROFILE%/.dsh/profiles/personal/package.json`（即 `C:/Users/<你>/.dsh/profiles/personal/package.json`）

   - 该目录**不存在** → 新建同名目录，放入「方式 D」那份 `package.json` 即可（`--profile personal` 按目录名解析）。
   - 该目录**已有文件** → 只**追加**，别整份覆盖：在 `dependencies` 里加一行 `link:`，在 `dsh.profile.bundles` 数组末尾加包名。
   - **`@local/dsh-scratchpad` 可以不写**：那是宿主的草稿本 bundle，与模具插件无关。没有对应目录就别加，加了反而 install 失败。
   - `link:` 必须改成**第 2 步在那台机器上的真实路径**，且用正斜杠，如 `link:D:/dsh-plugins/m10-mold-personal`（JSON 里反斜杠要转义，正斜杠最稳）。

4. **安装**：在 Harness 所在目录执行（宿主自带 pnpm 优先，全局 pnpm 版本不一致会失败）

   ```powershell
   & '<宿主目录>\node_modules\.bin\pnpm.cmd' install
   ```

   本包 `dependencies` 为空，这一步实质只是建立 `link:` 软链，秒完成。插件目录内**绝不要**裸跑 `npm install`。

5. **起实例**（cwd = 宿主仓库根；若你的 Harness 是安装器形态，用官方启动入口加 `--profile personal` 即可）

   ```powershell
   & 'C:\Program Files\nodejs\node.exe' --import tsx/esm apps/cli/src/bin.ts `
     --profile personal --no-open `
     --host <本机局域网IP> --port 3081 --trusted-host <本机局域网IP>:3081
   ```

   `--host` 换成本机 IP，端口被占就换（如 3082）。宿主只绑该地址，用 `127.0.0.1` 探端口会误判为未启动。

6. **自检**：

   ```powershell
   Invoke-WebRequest 'http://<本机IP>:3081/m10-mold-personal/api/version' -UseBasicParsing
   ```

   `ok: true` 即接通。404 → 先查 `bundles` 是否漏包名、以及改完配置是否**重启过实例**。

7. **首次使用**：「基础资料 → 组织」先建一个组织，否则任何单据保存都会被门禁拒回（见上文「做单前必须先建组织」）。数据落在 `%USERPROFILE%\.m10-mold-personal`，与插件包解耦，换机不带走即视为全新环境。

## 装好后自检

```powershell
# 版本回声（插件 API 路由，宿主 trusted-host 下可直连）
Invoke-WebRequest -Uri 'http://<本机IP>:3081/m10-mold-personal/api/version' -UseBasicParsing
```

预期 `ok: true` 且带版本号。若返回 404，先回查第 2 步的 `bundles` 是否漏加包名、以及是否重启过实例。

## 第一次上手（3 步）

1. 「基础资料 → 组织」建一个组织（如公司名/厂别名）——**不建组织无法做单**
2. 需要演示效果时，把 `cordis.patch.yml` 里 `sampleMolds: true` 的注号去掉并重启实例（会自动插一条示例模具）
3. 之后从「模具档案」新增模具，再走报修/保养/点检/领用归还等业务链

## 目录结构（v0.1.2 起：仓库根 = 插件包）

```
./                        # 仓库根就是包体，pnpm / 宿主直接读这里
├── package.json          # 包名 / exports / dsh.bundle / dsh.client(platform=web)
├── cordis.patch.yml      # 宿主注入：面板 id、routePrefix、moduleKey
├── client.js             # 前端 bundle（已构建产物，含内联样式）
├── locale/{zh,en}.json   # 插件卡片文案
├── server/
│   ├── index.js          # 服务端入口（exports["."]），API 路由挂载点
│   ├── sqlite/           # 数据层：db / adapter / schema / 页面与业务（raw ESM）
│   └── migrations/       # 001→012 递增迁移（user_version 驱动，幂等）
├── README.md             # 本文档
├── .gitignore / .gitattributes
```

## 版本与来源

- 版本权威 = `package.json` 的 `version` + git tag；运行时版本回声见 `/m10-mold-personal/api/version`（它直接读安装目录里的 `package.json`）
- 本仓内容由开发仓的插件包目录逐字节拷贝后入库，**两处受控差异**：① `cordis.patch.yml` 里一行注释做了脱敏（去掉内部账套名），有效配置行与开发仓逐行等同（已由脚本比对）；② 发布仓从 v0.1.2 起重排为「仓库根 = 插件包」（原本在子目录里），且 `version` 以发布仓为准——因为宿主的 git 安装是把整个仓库交给 pnpm、由 pnpm 读仓库根 `package.json`，子目录布局下贴地址装不上。前端源码（TypeScript/TSX）不随本仓发布，故**本仓不含前端重建能力**——需要改界面请在开发仓构建后替换 `client.js`。


## 多端 / 当主机（局域网手机访问）

桌面 App 形态的宿主固定只监听 127.0.0.1，手机无法直接访问宿主端口。本插件已内置**进程内独立局域网 HTTP 服务（零外部依赖）**：

1. **一键开启（推荐，无需额外部署 Node.js 或宿主源码目录）**：
   - 在任何安装了桌面 App 与本插件的电脑上，进入「AI模具管理 → 设置 → 手机局域网访问」，点击 **「启动局域网实例」**。
   - 插件会在当前进程内直接启动 `0.0.0.0:3081` 独立 Web 服务（共用同一个 SQLite 数据库连接，内联 React 运行时），1 秒内自动生成带免登录 Token 的二维码。
   - 手机或局域网内其他电脑在同一路由器/Wi-Fi 下直接扫码（或复制含 token 的访问地址打开）即可全屏进入模具管理系统。
2. **命令行脚本方式（可选，仅适用于部署了完整 Web 宿主源码仓的主机）**：
   - 随包保留 `scripts/personalLan.ps1`（`start / stop / status / autostart / unautostart`），供需要在无桌面 App 的源码宿主环境下后台常驻时使用。

多份数据口径：每台安装插件的电脑各自一套本地账套；要多端共享同一份数据，手机或其他电脑直接通过浏览器扫码/打开主机局域网地址即可，无需在从机重复安装插件。
