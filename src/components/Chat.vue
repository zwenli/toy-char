<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'

type Message = {
  type: string
  date?: number
  text?: string
  name: string
  target?: string
}
type UserList = string[]

// 用户列表
const userList: UserList = reactive(['kevin'])
// 我的用户名
const myUserName = ref('kevin')
// 目标用户名
const targetUserName = ref('')
// 消息列表
const msgList: Message[] = reactive([
  { type: 'message', date: Date.now(), text: 'this is info', name: 'kevin' },
])
const inputMsg = ref('xxx')

const sendDisabled = ref(true)
const handUpDisabled = ref(true)

const constraints = { video: true, audio: true }
let webcamStream: MediaStream | null

// 模板引用，模板ref和变量需要一致
const localVideo = ref<HTMLMediaElement | null>(null)
const receivedVideo = ref<HTMLMediaElement | null>(null)
// 登录
function connect() {
  log('user login: ' + myUserName.value)
  sendDisabled.value = false
}

// 发送消息
function sendMsg() {
  log('send message: ' + inputMsg.value)
  const text = inputMsg.value.trim()
  inputMsg.value = ''
  text &&
    msgList.push({
      type: 'message',
      name: myUserName.value,
      text,
      date: Date.now(),
    })
}

function log(content: any) {
  const date = new Date()
  console.log(`[${date.toLocaleTimeString()}]`, content)
}

// test
let callerConnection: RTCPeerConnection | null
let calleeConnection: RTCPeerConnection | null
const iceServers: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }, // 谷歌的公共服务
    {
      urls: 'turn:numb.viagenie.ca',
      credential: 'muazkh',
      username: 'webrtc@live.com',
    },
  ],
}

// 模拟 RTC连接
function createPeerConnection() {
  callerConnection = new RTCPeerConnection(iceServers)
  calleeConnection = new RTCPeerConnection(iceServers)
  
  webcamStream?.getTracks().forEach((track) => {
    console.log('track add', track)
    // 添加磁轨到连接，即发送给callee
    callerConnection?.addTrack(track, webcamStream as MediaStream)
  })
  
  // 监听ice候选信息，创建offer后会触发
  callerConnection.onicecandidate = function (event) {
    console.log('ice candidate event', event)
    if (event.candidate) {
      // 一般来说这个地方是通过第三方发送给另一个客户端，但是现在本地演示直接将候选信息发送到callee
      calleeConnection?.addIceCandidate(event.candidate?.toJSON())
    }
  }
  // 接收方监听是否有媒体流进入
  calleeConnection.ontrack = function (event) {
    // 视频track才添加进video
    if (event.track.kind === 'video') {
      if (receivedVideo.value) {
        receivedVideo.value.srcObject = event.streams[0]
      }
    }
  }
  
  createOffer()
}

// 模拟创建offer
async function createOffer() {
  if (!callerConnection || !calleeConnection) return
  // 呼叫方创建 offer
  const offer = await callerConnection.createOffer()
  
  // 设置本地描述
  await callerConnection?.setLocalDescription(offer)
  // 接收方设置远程描述
  await calleeConnection?.setRemoteDescription(offer)
  
  // 接收方创建 answer
  const answer = await calleeConnection.createAnswer()
  // 接收方设置本地描述
  await calleeConnection.setLocalDescription(answer)
  // 呼叫方设置远程描述
  await callerConnection.setRemoteDescription(answer)
}

async function createMidea() {
  webcamStream = await navigator.mediaDevices.getUserMedia(constraints)
  if (localVideo.value instanceof HTMLMediaElement) {
    localVideo.value.srcObject = webcamStream
  }
  // if (receivedVideo.value instanceof HTMLMediaElement) {
  //   receivedVideo.value.srcObject = webcamStream
  // }
  createPeerConnection()
  handUpDisabled.value = false
}

function hangup() {
  handUpDisabled.value = true
  // 清空媒体流
  if (localVideo.value instanceof HTMLMediaElement) {
    localVideo.value.srcObject = null
  }
  if (receivedVideo.value instanceof HTMLMediaElement) {
    receivedVideo.value.srcObject = null
  }
  // 关闭连接
  calleeConnection?.close()
  callerConnection?.close()
  // 关闭摄像头
  webcamStream?.getTracks().forEach((track) => track.stop())
  webcamStream = null
}

onMounted(() => {})
</script>

<template>
  <div class="char-container">
    <div class="info">
      <h2>simple video chat</h2>
      <p>enter a username to login</p>
      <label for="name"
        >username: <input id="name" v-model.trim="myUserName"
      /></label>
      <button @click="createMidea">login</button>
    </div>
    <ul class="user-list">
      <li v-for="user in userList" :key="user">{{ user }}</li>
    </ul>
    <div class="chat-box">
      <template v-for="msg in msgList">
        <template v-if="msg.type === 'message'"
          >({{ new Date(msg.date as number).toLocaleTimeString() }})
          <b>{{ msg.name }}</b
          >: {{ msg.text }}<br
        /></template>
      </template>
    </div>
    <div class="video-box">
      <video ref="receivedVideo" id="received-video" autoplay></video>
      <video ref="localVideo" id="local-video" muted autoplay></video>
      <button @click="hangup" :disabled="handUpDisabled">hang up</button>
    </div>
    <div class="chat-input">
      <input v-model="inputMsg" :disabled="sendDisabled" />
      <button @click="sendMsg" :disabled="sendDisabled">发送</button>
    </div>
  </div>
</template>

<style scoped>
.char-container {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: 150px 500px 60px;
  grid-gap: 0.4rem;
}
.info {
  grid-column: auto/span 5;
}
.chat-box {
  grid-column: auto/span 2;
}
.video-box {
  position: relative;
  grid-column: auto/span 2;
  display: flex;
  flex-direction: column;
}
#local-video {
  position: absolute;
  width: 30%;
  z-index: 3;
  top: 5%;
  left: 5%;
}
#received-video {
  /* position: absolute; */
  width: 100%;
  z-index: 2;
}
.chat-input {
  grid-column-start: 2;
  grid-column-end: 4;
}
</style>
