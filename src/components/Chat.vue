<script setup lang="ts">
import { ref, reactive, onMounted, h } from 'vue'

let myHostname = window.location.hostname
if (!myHostname) {
  myHostname = 'localhost'
}
log('Hostname: ' + myHostname)

let connection: WebSocket | null = null
let clientId: string | number | null = null

type Message = {
  type: string
  date?: number
  text?: string
  name: string
  target?: string
  sdp?: RTCSessionDescription
  candidate?: RTCIceCandidate
}
type UserList = string[]

// 用户列表
const userList: UserList = reactive([])
// 我的用户名
const myUserName = ref<string | null>('')
// 目标用户名
const targetUserName = ref<string | null>('')
// 消息列表
const msgList: Message[] = reactive([])
const inputMsg = ref('')

// send button
const sendDisabled = ref(true)
// hangup button
const handUpDisabled = ref(true)

// 媒体约束配置
const constraints = { video: true, audio: true }
// 摄像头媒体流
let webcamStream: MediaStream | null

// 模板引用，模板ref和变量需要一致
const localVideo = ref<HTMLMediaElement | null>(null)
const receivedVideo = ref<HTMLMediaElement | null>(null)
// 登录
function connect(evt: MouseEvent) {
  const serverUrl = 'ws://' + myHostname + ':6500'
  log(`Connecting to server: ${serverUrl}`)

  connection = new WebSocket(serverUrl)
  connection.onopen = function () {
    sendDisabled.value = false
  }
  connection.onerror = function (evt) {
    log('connection error: ')
    console.dir(evt)
  }
  connection.onmessage = function (evt) {
    const msg = JSON.parse(evt.data)
    log('Message received: ')
    console.dir(msg)
    const time = new Date(msg.date)
    const timeStr = time.toLocaleTimeString()
    switch (msg.type) {
      case 'id':
        // 接受到服务器的token消息后，存储token（clientID），
        // 并向服务器发送设置用户名的消息
        clientId = msg.id
        setUsername()
        break
      case 'userlist':
        userList.length = 0
        userList.push(...msg.users)
        break
      case 'rejectusername':
        myUserName.value = msg.name
        msgList.push(msg)
        break
      case 'message':
        msgList.push(msg)
        break
      case 'offer':
        handleOfferMsg(msg)
        break
      case 'answer':
        handleAnswerMsg(msg)
        break
      case 'new-ice-candidate':
        handleNewICECandidateMsg(msg)
        break
      case 'hang-up':
        handleHangUpMsg(msg)
        break
    }
  }
}

function sendToServer(msg: any) {
  const msgString = JSON.stringify(msg)
  log(`Sending '${msg.type}' message: ${msgString}`)
  connection?.send(msgString)
}

// 发送消息
function sendMsg() {
  log('send message: ' + inputMsg.value)
  const text = inputMsg.value.trim()
  inputMsg.value = ''
  text &&
    sendToServer({
      type: 'message',
      name: myUserName.value,
      text,
      date: Date.now(),
    })
}

function setUsername() {
  log('set username: ' + myUserName.value)
  sendToServer({
    type: 'username',
    name: myUserName.value,
    id: clientId,
    date: Date.now(),
  })
}

// 邀请用户进行视频通话
async function invite(name: string) {
  if (targetUserName.value) {
    alert('已存在视频连接')
    return
  }
  if (name === myUserName.value) {
    alert('您无法与自己视频通话')
    return
  }
  targetUserName.value = name
  log('inviting user ' + targetUserName.value)

  // 建立 RTCPeerConnction
  log('setting up connection to invite user ' + targetUserName.value)
  createPeerConnection()

  // 获取摄像头媒体流
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia(constraints)
    if (localVideo.value) {
      localVideo.value.srcObject = webcamStream
    }
  } catch (err) {
    handleGetUserMediaError(err)
  }

  // 媒体流添加到 peerConnection 中
  if (webcamStream !== null && myPeerConnction !== null) {
    try {
      // 可以通过addTransceiver 更加精确控制媒体流
      webcamStream.getTracks().forEach((track) => {
        myPeerConnction?.addTrack(track, webcamStream as MediaStream)
      })
    } catch (err) {
      handleGetUserMediaError(err)
    }
  }
}

async function handleOfferMsg(msg: Message) {
  targetUserName.value = msg.name
  log('received offer from ' + targetUserName.value)
  if (!myPeerConnction) {
    createPeerConnection()
  }
  if (!myPeerConnction) return

  const desc = new RTCSessionDescription(msg.sdp as RTCSessionDescription)
  if (myPeerConnction.signalingState !== 'stable') {
    log("  - But the signaling state isn't stable, so triggering rollback")
    await Promise.all([
      myPeerConnction.setLocalDescription({ type: 'rollback' }),
      myPeerConnction.setRemoteDescription(desc),
    ])
  } else {
    log('  - Setting remote description')
    await myPeerConnction.setRemoteDescription(desc)
  }

  // get camera stream if don't have it
  if (!webcamStream) {
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      handleGetUserMediaError(err)
    }
    if (localVideo.value) {
      localVideo.value.srcObject = webcamStream
    }
    // add camera stream to peerconnection
    try {
      webcamStream?.getTracks().forEach((track) => {
        myPeerConnction?.addTrack(track, webcamStream as MediaStream)
      })
    } catch (err) {
      handleGetUserMediaError(err)
    }
  }

  log('creating and sending answer to caller')
  // create answer
  await myPeerConnction.setLocalDescription(
    await myPeerConnction.createAnswer()
  )

  // send answer to remote peer
  sendToServer({
    type: 'video-answer',
    name: myUserName.value,
    target: targetUserName.value,
    sdp: myPeerConnction.localDescription,
  })
}

async function handleAnswerMsg(msg: Message) {
  log('recevied answer  ')
  if (!myPeerConnction) return
  try {
    const desc = new RTCSessionDescription(msg.sdp as RTCSessionDescription)
    await myPeerConnction.setRemoteDescription(desc)
  } catch (err) {
    log('set remote description error: ')
    console.log(err)
  }
}

function handleHangUpMsg(msg: Message) {
  log('received hang-up message')
  closeVideoCall()
}

async function handleNewICECandidateMsg(msg: Message) {
  if (!myPeerConnction) return
  const candidate = new RTCIceCandidate(msg.candidate)
  log('Adding received ice candidate: ' + JSON.stringify(candidate))
  try {
    await myPeerConnction.addIceCandidate(candidate)
  } catch (err) {
    log('add ice candidate error: ')
    console.dir(err)
  }
}

function log(content: any) {
  const date = new Date()
  console.log(`[${date.toLocaleTimeString()}]`, content)
}

// test
let myPeerConnction: RTCPeerConnection | null
const pcConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }, // 谷歌的公共服务
    {
      urls: `turn:${myHostname}:6500`,
      credential: 'kevin',
      username: 'kevin',
    },
  ],
}

//
function createPeerConnection() {
  log('setting up a connection')
  myPeerConnction = new RTCPeerConnection(pcConfig)

  // setting up event handler

  myPeerConnction.onnegotiationneeded = handleNegotiationNeededEvent
  myPeerConnction.onicecandidate = handleICECandidateEvent
  myPeerConnction.ontrack = handleTrackEvent
  // 以下状态变化事件，主要是用来处理 ‘closed’ 情况 
  myPeerConnction.oniceconnectionstatechange = handleICEConnectionStateChangeEvent
  myPeerConnction.onicegatheringstatechange = handleICEGatheringStateChangeEvent
  myPeerConnction.onsignalingstatechange = handleSignalingStateChangeEvent
}

// negotiation needed事件，浏览器通知应用程序需要进行会话协商（session negotiation）
// 即 createOffer，再调用 setLocalDescription
async function handleNegotiationNeededEvent() {
  log('*** negotiation needed')
  if (myPeerConnction === null) return

  try {
    log('---> creating offer')
    const offer = await myPeerConnction.createOffer()

    // stable 状态，表示没有正在进行交换offer/answer，也是初始状态
    if (myPeerConnction.signalingState !== 'stable') {
      log("     -- The connection isn't stable yet; postponing...")
      return
    }

    log('---> setting local description to the offer')
    await myPeerConnction.setLocalDescription(offer)

    log('---> sending the offer to the remote peer')
    const offerMsg = {
      type: 'video-offer',
      name: myUserName.value,
      target: targetUserName.value,
      sdp: myPeerConnction.localDescription,
    }
    sendToServer(offerMsg)
  } catch (err) {
    log(
      '*** The following error occurred while handling the negotiationneeded event:'
    )
    console.dir(err)
  }
}

// 监听ice候选信息，本地代理创建SDP Offer并调用 setLocalDescription(offer) 后触发
// 一般来说是通过信令服务器将候选信息发送给远端
function handleICECandidateEvent(event: RTCPeerConnectionIceEvent) {
  if (event.candidate) {
    // 发送 ice candidate 给远端
    log('Outgoing ICE candidate: ' + event.candidate.candidate)
    sendToServer({
      type: 'new-ice-candidate',
      name: myUserName.value,
      target: targetUserName.value,
      candidate: event.candidate,
    })
  } else {
    // 所有 ice candidate 已发送完毕
  }
}

// 媒体流事件，远端添加track后，连接会触发此事件
function handleTrackEvent(event: RTCTrackEvent) {
  log('*** track event')
  console.dir(event)
  if (event.track.kind === 'video') {
    receivedVideo.value && (receivedVideo.value.srcObject = event.streams[0])
    handUpDisabled.value = false
  }
}

// ice connection state change event
function handleICEConnectionStateChangeEvent(event: Event) {
  log('ICE connection state changed to ' + myPeerConnction?.iceConnectionState)
  switch (myPeerConnction?.iceConnectionState) {
    case 'closed':
    case 'failed':
    case 'disconnected':
      closeVideoCall()
      break
  }
}

function handleICEGatheringStateChangeEvent(event: Event) {
  log('ICE gathering state changed to ' + myPeerConnction?.iceGatheringState)
  // switch (myPeerConnction?.iceConnectionState) {
  //   case 'closed':
  //   case 'disconnected':
  //   case 'failed':
  //     closeVideoCall()
  //     break
  // }
}

function handleSignalingStateChangeEvent(event: Event) {
  log('Signaling state changed to ' + myPeerConnction?.signalingState)
  switch (myPeerConnction?.signalingState) {
    case 'closed':
      closeVideoCall()
      break;
  }
}

// 模拟创建offer
/**
 A                                                                        B
 A.createOffer()
 |
 A.setLocalDescription() -------发送offer(触发icecandidate)------->       B.setRemoteDescription()
                                                                                    |
                                                                         B.createAnswer()
                                                                                    |
 A.setRemoteDescription()  <------发送answer--------                      B.setLocalDescription()
 */
// async function createOffer() {
//   if (!myPeerConnction || !calleeConnection) return
//   // 呼叫方创建 offer
//   const offer = await myPeerConnction.createOffer()

//   // 设置本地描述
//   await myPeerConnction?.setLocalDescription(offer)
//   // 接收方设置远程描述
//   await calleeConnection?.setRemoteDescription(offer)

//   // 接收方创建 answer
//   const answer = await calleeConnection.createAnswer()
//   // 接收方设置本地描述
//   await calleeConnection.setLocalDescription(answer)
//   // 呼叫方设置远程描述
//   await myPeerConnction.setRemoteDescription(answer)
// }

// async function createMidea() {
//   webcamStream = await navigator.mediaDevices.getUserMedia(constraints)
//   if (localVideo.value instanceof HTMLMediaElement) {
//     localVideo.value.srcObject = webcamStream
//   }
//   // if (receivedVideo.value instanceof HTMLMediaElement) {
//   //   receivedVideo.value.srcObject = webcamStream
//   // }
//   createPeerConnection()
//   handUpDisabled.value = false
// }

//
function handleGetUserMediaError(e: unknown) {
  log(e)
  switch (e.name) {
    case 'NotFoundError':
      alert(
        'Unable to open your call because no camera and/or microphone' +
          'were found.'
      )
      break
    case 'SecurityError':
    case 'PermissionDeniedError':
      // Do nothing; this is the same as the user canceling the call.
      break
    default:
      alert('Error opening your camera and/or microphone: ' + e.message)
      break
  }

  // Make sure we shut down our end of the RTCPeerConnection so we're
  // ready to try again.

  closeVideoCall()
}

function closeVideoCall() {
  handUpDisabled.value = true
  // 清空视频
  if (localVideo.value) {
    localVideo.value.pause()
    localVideo.value.srcObject = null
  }
  if (receivedVideo.value) {
    receivedVideo.value.pause()
    receivedVideo.value.srcObject = null
  }
  // 关闭连接
  if (myPeerConnction) {
    myPeerConnction.onicecandidate = null
    myPeerConnction.onnegotiationneeded = null
    myPeerConnction.ontrack = null
    myPeerConnction.getTransceivers().forEach((transceiver) => {
      transceiver.stop()
    })
    // 调用close()，各个状态都会变更为'closed'
    myPeerConnction.close()
    myPeerConnction = null
  }
  // 关闭摄像头
  if (webcamStream) {
    webcamStream.getTracks().forEach((track) => {
      track.stop()
    })
    webcamStream = null
  }
  targetUserName.value = null
}

function hangup() {
  sendToServer({
    type: 'hang-up',
    name: myUserName.value,
    target: targetUserName.value,
  })
  closeVideoCall()
}

onMounted(() => {})
</script>

<template>
  <div class="char-container">
    <div class="info">
      <h2>simple video chat</h2>
      <p>enter a username to login</p>
      <label for="name"
        >username:
        <input
          id="name"
          v-model.trim="myUserName"
          placeholder="input your username"
      /></label>
      <button @click="connect">login</button>
    </div>
    <ul class="user-list">
      <li
        class="user-item"
        v-for="user in userList"
        :key="user"
        @click="invite(user)"
      >
        {{ user }}
      </li>
    </ul>
    <div class="chat-box">
      <template v-for="msg in msgList">
        <template v-if="msg.type === 'message'"
          >({{ new Date(msg.date as number).toLocaleTimeString() }})
          <b>{{ msg.name }}</b
          >: {{ msg.text }}<br
        /></template>
        <template v-if="msg.type === 'rejectusername'"
          ><b
            >Your username has been set to <em>{{ msg.name }}</em> because the
            name you chose is in use.</b
          ><br />
        </template>
      </template>
    </div>
    <div class="video-box">
      <video ref="receivedVideo" id="received-video" autoplay></video>
      <video ref="localVideo" id="local-video" muted autoplay></video>
      <button @click="hangup" :disabled="handUpDisabled">hang up</button>
    </div>
    <div class="chat-input">
      <input
        v-model="inputMsg"
        :disabled="sendDisabled"
        placeholder="input message"
      />
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

.user-item {
  cursor: pointer;
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
