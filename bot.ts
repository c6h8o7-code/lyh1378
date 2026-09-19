const mineflayer = require("mineflayer");
const pathfinder = require("mineflayer-pathfinder").pathfinder;
const Movements = require("mineflayer-pathfinder").Movements;
const { GoalNear, GoalExact } = require("mineflayer-pathfinder").goals;
// const pvp = require('mineflayer-pvp').plugin
const { Vec3 } = require("vec3");

const config = require("./config.json");
const config_north = require("./config_north.json");
const config_useful = require("./config_useful.json");
// const inventoryViewer = require('mineflayer-web-inventory')
const botOptions = {
  host: "h1.getmc.cn",
  username: "lyh1378",
  port: 31410,
  version: "1.21.10",
  keepAlive: true,
};
const { mineflayer: mineflayerViewer } = require('prismarine-viewer')

const settings = require("./settings.json");
const fpn = settings["fake_player_name"];
let canHello = false;
let spawnFakePlayer = false;
let successToGetSbox = false;
let tossItems: { type: number; count: number; name: string }[] = [];
let clearFakePlayer = settings["clear_fake_player_default"];

const RECONNECT_DELAY = 2000;
let isReconnecting = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let loginTime;
let killInterval: NodeJS.Timeout = setInterval(() => {}, 5000);

console.log("正在尝试连接服务器");
let bot = mineflayer.createBot(botOptions);
bot.loadPlugin(pathfinder);
// bot.loadPlugin(pvp);
setupBot();

async function autoKill() {
  if (bot.food <= 6) {
    bot.chat("!!kill");
    return;
  }
}

process.stdin.on("data", (data)=>{
  if(data.toString().trim().startsWith("/run ")){
    let command = data.toString().trim().slice(5);
    try{ 
      eval(command)
    }catch(e){
      console.log(e)
    }
  }
  bot.chat(data.toString().trim());
})
function getConfigs(
  itemName: string
): ([number, string, string] | [number, string, string, number])[] {
  return [
    config[itemName],
    config_north[itemName],
    config_useful[itemName],
  ].filter((x) => x !== undefined);
}
class ItemRequest {
  name: string = "";
  count: number = 0;
  unit: string = "个";
  shulker_positions: [number, number, number][] = [];
  take_shulker_positions: [number, number, number][] = [];
  stand_positions: [number, number, number][] = [];
  take_positions: [number, number, number][] = [];
  stack: number;
  w: string[] = [];
  constructor(name: string, count: number, unit: string) {
    this.count = count;
    this.name = name;
    this.unit = unit;
    let confs = getConfigs(name);
    if (confs.length === 0) throw new Error("物品 " + name + " 检索失败！");
    console.log(confs);
    this.stack = confs[0][3] ?? 64;
    for (let i of confs) {
      let w = i[1];
      let Zindex = i[0];
      switch (w) {
        case "left":
          this.shulker_positions.push([3, 86, Zindex]);
          this.take_shulker_positions.push([2, 88, Zindex]);
          this.w.push("大宗");
          this.stand_positions.push([5.5, 87, Zindex]);
          break;
        case "right":
          this.shulker_positions.push([13, 86, Zindex]);
          this.take_shulker_positions.push([14, 88, Zindex]);
          this.w.push("大宗");
          this.stand_positions.push([11.5, 87, Zindex]);
          break;
        case "useful":
          this.shulker_positions.push([13, 87, Zindex]);
          this.take_shulker_positions.push([12, 90, Zindex]);
          this.w.push("常用");
          this.stand_positions.push([10.5, 87, Zindex]);
          break;
        case "leftN":
          this.shulker_positions.push([3, 87, Zindex]);
          this.take_shulker_positions.push([2, 86, Zindex]);
          this.w.push("北仓");
          this.stand_positions.push([5.5, 87, Zindex]);
          break;
        case "rightN":
          this.shulker_positions.push([13, 87, Zindex]);
          this.take_shulker_positions.push([14, 86, Zindex]);
          this.w.push("北仓");
          this.stand_positions.push([11.5, 87, Zindex]);
          break;
        default:
          throw new Error("配置出错！");
      }
    }
    if (unit === "盒") {
      this.take_positions = this.take_shulker_positions.slice();
    } else {
      this.take_positions = this.shulker_positions.slice();
    }
  }
  async getItem() {
    let confs = getConfigs(this.name);
    let itemid = this.unit !== "盒" ? confs[0][2] : "shulker_box";
    let remaining = this.count * (this.unit === "组" ? this.stack : 1);
    let attempts = 0;
    const maxAttempts = 5;
    let totalTaken = 0;
    let successful = 1;
    console.log(itemid)
    for (let i = 0; i < this.stand_positions.length; i++) {
      attempts = 0;
      let Pos = this.stand_positions[i];
      await gotoPos(Pos[0], Pos[1], Pos[2]);
      while (remaining > 0 && attempts < maxAttempts) {
        ++attempts;
        const block = bot.blockAt(
          new Vec3(
            this.take_positions[i][0],
            this.take_positions[i][1],
            this.take_positions[i][2]
          )
        );
        if (
          !block ||
          (block.name !== "chest" &&
            block.name !== "dropper" &&
            !block.name.endsWith("shulker_box"))
        ) {
          if (totalTaken > 0) {
            bot.chat(
              `容器消失，已取出 ${totalTaken} 个，未达到需求 ${this.count} ${this.unit}，等待换盒`
            );
            await sleep(1000)
            continue
          } else {
            bot.chat(`指定位置${this.take_positions}不是容器或容器已消失`);
            console.warn(`指定位置${this.take_positions}不是容器或容器已消失`);
            break;
          }
        }

        const chest = await bot.openContainer(block);
        try {
          const items = chest.containerItems();
          const targetItems = items.filter(
            (i: { type: number; count: number; name: string }) => {
              // console.log(i.name);
              return i.name && i.name.includes(itemid);
            }
          );
          let totalInChest = targetItems.reduce(
            (sum: number, i: { type: number; count: number; name: string }) =>
              sum + i.count,
            0
          );
          if (totalInChest === 0) {
            await chest.close();
            if (this.w[i] === "北仓") {
              bot.chat(`当前盒内无 ${this.name}，等待换盒...`);
              await sleep(1000);
              continue;
            } else {
              bot.chat(`容器中没有 ${this.name}`);
              break;
            }
          }
          let takeCount = Math.min(totalInChest, remaining);
          for (const item of targetItems) {
            if (takeCount <= 0) break;
            const take = Math.min(item.count, takeCount);
            console.log("取出", take, "个物品")
            await chest.withdraw(item.type, null, take);
            tossItems.push({ type: item.type, count: take, name: item.name });
            totalTaken += take;
            remaining -= take;
            takeCount -= take;
          }
          await chest.close();
          console.log(`本次取出 ${totalTaken} 个，剩余需求 ${remaining}`);

          if (remaining <= 0) {
            console.log("成功取物，共取出 " + totalTaken + " 个");
            return [];
          }
          if (this.w[i] === "北仓" || this.unit !== "盒") {
            await sleep(1500);
          } else {
            console.log(`库存不足，仅取出 ${totalTaken} 个，换下一位置`);
            break;
          }
        } catch (e) {
          bot.chat("取物出错：" + e);
          await chest.close();
          console.log(e);
        }
      }
    }
    if (remaining > 0) successful = 0;
    if(successful) return [];
    else return [`${this.name}储量不足，只投放若干`];
  }
  usage(){
    if(this.unit !== "个") return this.count;
    return Math.ceil(this.count / this.stack);
  }
}

async function toPack() {
  bot.chat("!!kill")
  let pos = {x:21, y:84, z:62};
  await gotoPos(8, 84, 50);
  await gotoPos(21, 84, 50);
  await gotoPos(pos.x-1, pos.y, pos.z);

  const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
  if (!block || !block.name.endsWith('shulker_box')) {
    throw new Error(`坐标 (${pos.x}, ${pos.y}, ${pos.z}) 处没有潜影盒`)
  }

  const container = await bot.openContainer(block)
  try {
    for (let i = 9; i <= 44; i++) {
      const item = bot.inventory.slots[i]
      if (item) {
        await container.deposit(item.type, item.metadata, item.count)
      }
    }
  } catch(e){}
  finally {
    await container.close()
  }
  const noteblock = bot.blockAt(new Vec3(19, 84, 62));
  await bot.activateBlock(noteblock);
  await sleep(1000)
}
async function dropAll() {
  for (let i = 9; i <= 44; i++) {
    const item = bot.inventory.slots[i];
    if (item) {
      await bot.tossStack(item);
    }
  }
}
async function dropToFakePlayer(){
  await gotoPos(8, 87, -6);
  await bot.lookAt(new Vec3(4, 88, -6));
  await dropAll();
  await sleep(4000);
}

async function executeAirdropNew(itemlist: ItemRequest[]) {
  bot.chat("!!kill")
  await clearAirdropPlayer()
  await sleep(500);
  bot.chat(`/player ${fpn} kill`);
  await sleep(500);
  bot.chat(`/player ${fpn} spawn at 5.5 87 -5.5`);
  await sleep(500);
  let t1=0, t2=0, tmp=0;
  let b = [], t: ItemRequest[] = [];
  for(let item of itemlist){
    t1+=item.usage();
    if(item.unit === "盒") t2+=item.usage();
    else {
      if(tmp+item.usage()>=27) {
        t.push(new ItemRequest(item.name, 27-tmp, "组"));
        b.push(t);
        t=[];
        t.push(new ItemRequest(item.name, item.count-(27-tmp) * (item.unit === "组"?1:item.stack), item.unit));
      }
      else t.push(item);
      tmp+=item.usage();
    }
    while(tmp >= 27) t2++, tmp-=27;
  }
  if(t.length) b.push(t)
  if(tmp>0) t2++;
  if(t2>36) return "物品太多了，无法空投！";
  if(t1<=36){
    tmp=1;
  }else{
    tmp=0;
  }
  // 空投 红色混凝土10组 粉色混凝土10组 黄色混凝土10组
  let message:string[] = [];
  console.log(b);
  for(let i of itemlist.filter(x=>x.unit === "盒")){
    let T = await i.getItem();
    message.concat(T);
    await dropToFakePlayer();
  }
  for(let i of b){
    for(let j of i){
      let T = await j.getItem();
      message.concat(T);
    }
    if(!tmp){
      await toPack();
    }
    await dropToFakePlayer();
  }

  return message.join("\n");
}

async function gotoPos(x: number, y: number, z: number, dis = 0.1) {
  const defaultMove = new Movements(bot);
  bot.setControlState("sprint", true);
  defaultMove.allow1by1towers = false
  defaultMove.canDig = false;
  defaultMove.allowSprinting = true;
  defaultMove.allowParkour=true

  defaultMove.maxDropDown = 100
  // @ts-ignore
  bot.pathfinder.setMovements(defaultMove);

  const goal = new GoalNear(x, y, z, dis);
  try {
    console.log(`正在前往 (${x}, ${y}, ${z})`);
    // @ts-ignore
    await bot.pathfinder.goto(goal);
    console.log(`已到达 (${x}, ${y}, ${z})`);
  } catch (err: any) {
    console.error(`寻路失败: ${err.message}`);
  }
}

async function clearAirdropPlayer() {
  const lockInput = bot.blockAt(new Vec3(5, 83, 8));
  if (lockInput != null && lockInput.name === "redstone_block") {
    bot.chat("全物品输入口已锁定，不进行清空假人");
    return false;
  }
  await gotoPos(6.5, 87, 8.5)
  await dropAll()
  const input = bot.blockAt(new Vec3(7, 86, 7))
  if(input != null && input.name === "smooth_quartz"){
    const noteblock = bot.blockAt(new Vec3(6, 86, 6));
    await bot.activateBlock(noteblock);
  }
  bot.chat(`/player ${fpn} kill`);
  await sleep(200);
  bot.chat(`/player ${fpn} spawn at 7.5 87 10.3 facing -150 30`);
  await sleep(1000);
  bot.chat(`/player ${fpn} dropStack all`);
  await sleep(500);
  return true;
}

let doing = false;

function setupBot() {
  bot.once("login", () => {
    bot.chat("/l 114514");
    loginTime = Date.now();
    if (killInterval) clearInterval(killInterval);
    killInterval = setInterval(autoKill, 5000);
  });

  bot.on("message", (jsonMsg: string) => {
    const text = jsonMsg.toString();
    console.log(text)
    if (
      text.includes(bot.username) ||
      text.startsWith("=") ||
      text.startsWith("附近")
    ) {
      return;
    }
    const match = text.match(
      /(\S+)\s+\[([-+]?\d+\.?\d*)\s*,\s*([-+]?\d+\.?\d*)\s*,\s*([-+]?\d+\.?\d*)\]/
    );

    if (match) {
      const orgindim = match[1];
      const x = parseFloat(match[2]);
      const y = parseFloat(match[3]);
      const z = parseFloat(match[4]);
      let dim;
      if (orgindim === "主世界") {
        dim = "minecraft:overworld";
      } else if (orgindim === "地狱") {
        dim = "minecraft:the_nether";
      } else if (orgindim === "末地") {
        dim = "minecraft:the_end";
      } else {
        dim = undefined;
      }
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        console.log(`捕获坐标：(${x}, ${y}, ${z}) in ${dim}`);
        if (spawnFakePlayer) {
          bot.chat(
            `/player ${fpn} spawn at ${x} ${y} ${z} facing 0 0 in ${dim}`
          );
          spawnFakePlayer = false;
        }
        return;
      }
    }
  });
  bot.on("chat", async (username: string, message: string) => {
    // if (username === bot.username) return;
    // console.log("<"+username+">:", message)
    let targetUser = username;
    let msg = message;
    const giveMatch = msg.match(/^给(\S+?)(空投\s+.+)$/);
    if (giveMatch) {
      targetUser = giveMatch[1];
      msg = giveMatch[2];
    }

    const parts = msg.split(" ");
    const command = parts[0];
    const command1 = parts[1]
    if (command === "1378" && command1 === "move") {
      if(doing) {
        bot.chat("正在执行任务！")
        return;
      }
      
      if (parts.length < 4) {
        bot.chat("用法: 1378 move x y z");
        return;
      }
      const x = parseFloat(parts[2]);
      const y = parseFloat(parts[3]);
      const z = parseFloat(parts[4]);
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        bot.chat("坐标不合法");
        return;
      }
      doing=true;
      await gotoPos(x, y, z);
      doing=false;
      return;
    }
    if(command === "空投滚木"){
      if(doing) return; doing=true;
      await executeAirdropNew([]);
       bot.chat(`/player ${fpn} kill`);
        bot.chat(`${targetUser}在哪`);
        spawnFakePlayer = true;
        doing=false
    }
    if (command === "空投" || command === "1378" && command1 === "空投") {
      let rest = parts.slice(1).join(" ");
      if(command === "1378") rest = parts.slice(2).join(" ");
      const re = /(\S+?)(\d+)([个组盒])/g;
      let match;
      const airdrops = [];
      while ((match = re.exec(rest)) !== null) {
        try{
          airdrops.push(new ItemRequest(match[1], parseInt(match[2], 10), match[3]));
        }catch(e){
          // bot.chat(e as string);
          bot.chat(match[1]+"检索失败")
          return;
        }
      }

      if (airdrops.length === 0) {
        bot.chat("格式错误,用法: 1378 空投 <物品名><数量><单位> ...");
        bot.chat("         或: 空投 <物品名><数量><单位> ...");
        return;
      }
      if(doing) {
              bot.chat("正在执行任务！")
              return;
      }
      doing = true;
      let cfp = clearFakePlayer;
      successToGetSbox = false;
      console.log(airdrops)
      const result = await executeAirdropNew(airdrops);
      cfp = false;
      bot.chat(result);
      bot.chat(`/player ${fpn} kill`);
      bot.chat(`${targetUser}在哪`);
      spawnFakePlayer = true;
      doing=false;
      return;
    }

    if (command === "kill1378" || command === "1378" && command1 === "kill") {
      bot.chat("!!kill");
    }
    if (command === "1378" && command1 === "抽奖"){
      bot.chat("/tell "+username+" 正在抽奖中~")
      let prices = ["雪镇谷度假", "北雪镇度假", "南雪镇度假", "发配修铁路", "发配修建筑", "啥都没有", "啥都没有", "啥都没有", "啥都没有", 
        "8号线车票全程，必须做完", "S6号线车票全程，必须做完", "1号线车票全程，必须做完", "2号线车票全程，必须做完", "发配修铁路", "发配修建筑"]
      let w = Math.floor(Math.random()*15);
      bot.chat("/tell "+username+" 纯属娱乐，切勿当真");
      bot.chat("/tell "+username+" 你抽到了：" + prices[w]);
      if(w == 0 || w == 1 || w == 2){
        bot.chat("恭喜"+username+"抽到了"+prices[w]);
      }else if(w == 3 || w == 4 || w>=9){
        bot.chat("真·恭喜"+username+"抽到了"+prices[w]);
      }
    }
    if(command === "1378" && command1 === "--help"){
      bot.chat("用法：")
      bot.chat("- 1378 空投 <itemname><count><unit> [<itemname2><count2><unit2>...]");
      bot.chat("- 1378 抽奖");
      bot.chat("- 1378 kill");
      bot.chat("- 1378 --Version");
      bot.chat("- 1378 --help");
      bot.chat("- 1378 hello [<playername>]")
    }
    if(command === "1378" && command1 === "--Version"){
      bot.chat("lyh1378, Version 2.0.1")
    }
    if(command === "1378" && command1 === "hello"){
      let command2 = parts[2] ?? username;
      bot.chat("你好！"+command2+"，全物品假人lyh1378为你服务。输入 \"1378 --help\"即可查看我的用法！");
    }
    
  });

  bot.once("spawn", async () => {
    console.log("成功进入服务器");
    isReconnecting = false;
    await sleep(1000);
    bot.chat("空投机器人lyh1378已上线（Version 2.0.1）");
    // bot.pvp.movements.allow1by1towers=false;
    bot.pvp.movements.canDig=false;
    bot.pvp.movements.allowSprinting = true;
    bot.pvp.movements.allowParkour=true
    bot.pvp.movements.maxDropDown = 100

    // inventoryViewer(bot)
    // mineflayerViewer(bot, {port: 3007, firstPerson: false});
  });

  bot.on("end", (reason: string) => {
    console.warn(`连接已断开，原因: ${reason}`);
    bot=mineflayer.createBot(botOptions);
    bot.loadPlugin(pathfinder)
// bot.loadPlugin(pvp);
    setupBot();
  });

  bot.on("error", (err: any) => {
    console.log(`发生错误: ${err.message}`);
  });
}

/*
/run bot.chat(`/player bot_airdrop kill`)
/run spawnFakePlayer=true
/run bot.chat(`hongyan250在哪`)
*/