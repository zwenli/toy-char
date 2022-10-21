import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'

interface Connection extends WebSocket {
  clientId?: number
  username?: string
}

function log(text) {
  const time = new Date()
  console.log(`[${time.toLocaleTimeString()}] ${text}`)
}

// 连接列表
let connectionList: Connection[] = []
let nextId = Date.now()
let appendToMakeUnique = 1

function sendToOneUser(target, msgString) {
  for (const client of connectionList) {
    if (client.username === target) {
      client.send(msgString)
      break
    }
  }
}

// 检查用户名是否唯一
function isUsernameUnique(name) {
  let isUnique = true
  for (const client of connectionList) {
    if (client.username === name) {
      isUnique = false
      break
    }
  }
  return isUnique
}

function getConnectionForID(id) {
  let target: Connection | null = null
  for (const connection of connectionList) {
    if (connection.clientId === id) {
      target = connection
      break
    }
  }
  return target
}

// 用户列表消息
function makeUserListMessage() {
  const userListMsg = {
    type: 'userlist',
    users: [] as (string | undefined)[]
  }
  for (const connection of connectionList) {
    userListMsg.users.push(connection.username)
  }
  return userListMsg
}

// 发送消息事件给全部客户端
function sendUserListToAll() {
  const userListMsgString = JSON.stringify(makeUserListMessage())
  for (const connection of connectionList) {
    connection.send(userListMsgString)
  }
}

// websocket server
const wss = new WebSocketServer({ port: 6500 })

wss.on('connection', onConnection)

// 客户端连接事件
function onConnection(ws: Connection) {
  log('connection accepted from: ' + (ws._socket as any).remoteAddress)
  ws.clientId = ++nextId
  connectionList.push(ws)

  // 回传token(clientId)给客户端
  const msg = {
    type: 'id',
    id: ws.clientId,
  }
  ws.send(JSON.stringify(msg))

  ws.on('message', onMessage)
  ws.on('close', onClose)
}

// message事件，处理客户端发送的消息
function onMessage(data) {
  const msgString = data.toString()
  log('received message: ' + msgString)
  const msg = JSON.parse(msgString)
  let sendToClients = true

  switch (msg.type) {
    case 'message': // 普通消息
      msg.name = this.username
      msg.text = msg.text.replace(/(<([^>]+)>)/gi, '')
      break
    case 'username': // 用户名称更新消息
      let nameChanged = false
      let originName = msg.name
      
      while (!isUsernameUnique(msg.name)) {
        msg.name = originName + appendToMakeUnique
        appendToMakeUnique++
        nameChanged = true
      }
      
      // 如果名称发生变化，服务器需要回传“rejectusername”消息给客户端
      // 告知客户端他们的名称在服务器已发生变化
      if (nameChanged) {
        const changeMsg = {
          type: 'rejectusername',
          id: msg.id,
          name: msg.name,
        }
        this.send(JSON.stringify(changeMsg))
      }
      // 更新用户名称
      this.username = msg.name
      sendUserListToAll()
      sendToClients = false
      break
  }

  if (sendToClients) {
    const msgString = JSON.stringify(msg)
    if (msg.target && msg.target.length) {
      sendToOneUser(msg.target, msgString)
    } else {
      connectionList.forEach((connection) => connection.send(msgString))
    }
  }
}

// websocket 关闭事件
function onClose() {
  log('connection close from ' + this.clientId)
  // connection.readyState === 3 // 连接已关闭
  connectionList = connectionList.filter(connection => connection.readyState !== 3)
  // 更新用户列表
  sendUserListToAll()
}
