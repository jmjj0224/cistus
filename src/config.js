// 게임의 숫자는 전부 여기 있어요. 바꾸고 새로고침하면 바로 반영돼요.
export const CFG = {
  // 내부 해상도 (16:9). 화면에는 픽셀 그대로 확대돼요.
  renderW: 427,
  renderH: 240,

  seed: 20261111, // 숲 배치를 정하는 숫자. 바꾸면 나무·매미 위치가 달라져요.
  zoneRadius: 29, // 걸어 다닐 수 있는 구역의 반지름(m)

  player: { eye: 1.62, walk: 2.7, run: 3.9, radius: 0.32 },

  cicada: {
    count: 12,
    perLighter: 4, // 라이터 하나로 태우는 매미 수
    burnSeconds: 3, // 누르고 있어야 하는 시간
    reach: 1.9, // 태울 수 있는 거리(m)
    size: 0.3, // 매미 그림 크기(m). 실제보다 크게 그려요.
  },

  // 자막 한 토막이 떠 있는 시간 = 글자 수 / charsPerSecond (min~max 사이)
  line: { minSeconds: 8, maxSeconds: 14, charsPerSecond: 9 },

  lighterSwapSeconds: 5,
  mintSeconds: 6, // 3번째 매미 뒤 민트초코 컷 길이

  // 행인: 매미를 태우는 모습을 보고 서 있다가, 다가가면 숲 밖으로 달아나요.
  witness: {
    afterBurn: 6, // 몇 번째 매미를 태운 직후에 나타날지 (0이면 안 나옴)
    spawnDist: 3.6, // 남자 바로 등 뒤 몇 m에 서 있을지
    fleeDist: 2.3, // 이 거리 안으로 다가가면 달아남
    timeout: 45, // 다가가지 않아도 이 시간이 지나면 달아남(초)
    speed: 7.5, // 달아나는 속도(m/s). 남자가 뛰는 속도보다 빨라요.
    height: 1.78,
  },

  reveal: { seconds: 15 }, // 12번째 매미 뒤 괴물 등장 연출 길이
  choiceSeconds: 150, // 괴물에게도 나가는 길로도 가지 않고 버틸 때, 이 시간이 지나면 그 자리에서 쓰러져요

  // 숲 밖으로 나가는 길: 흰 빛을 향해 걸어도 끝나지 않고, 걷다가 쓰러져요.
  corridor: {
    seconds: 40, // 이 길 위에서 보낸 시간이 이만큼 되면 쓰러져요
    lightDist: 26, // 흰 빛이 늘 떠 있는 거리(m)
  },

  monster: {
    bodyHeight: 3.3, // 키(m)
    spawnDist: 20,
    stopDist: 5.6, // 안 보는 사이 여기까지 다가와요. 2단계까지는 저절로 열리고, 3단계와 접촉은 남자가 다가가야 해요
    fogHide: 22, // 이보다 멀면 안개에 묻혀 안 보이는 것으로 쳐요(그동안 다가와요)
    stageDist: [11, 8, 5], // 남자가 이 거리 안으로 들어올 때마다 한 단계 열려요
    enterDist: 2.5, // 이 안으로 들어가면 접근 엔딩
    speedRatio: 1.05, // 안 볼 때 다가오는 속도(남자 걷는 속도 대비). 멀리 있을 땐 1.5배
  },

  runEnding: {
    trembleSeconds: 5, // 눈 클로즈업에서 떠는 시간
    zoomFrom: 4, // 시작 확대 배율
    zoomSeconds: 20, // 줌아웃에 걸리는 시간
    pocketSeconds: 4, // 주머니 그림을 보여 주는 시간
    pocketCut: true, // "주머니 속엔" 대목에서 주머니 그림을 잠깐 보여 줄지
  },

  approachEnding: {
    veilSeconds: 8, // W를 누른 채 첫 장막을 지나는 속도 기준. 안쪽 막일수록 느려져서 전체는 12초쯤 걸려요
    squeezeSeconds: 1.6, // 마지막에 양옆에서 조여 오는 시간
    blackSeconds: 2,
    holdSeconds: 2.5, // 흰 바닥에 떨어진 뒤 나레이션과 곡이 시작되기까지
  },

  // 아래 파일은 있으면 쓰고 없으면 건너뛰어요.
  song: {
    // 원곡의 2:04부터 끝(2:41)까지만 잘라 둔 파일이에요. 원곡 전체 파일로 바꾸면 from을 124로 적으면 돼요.
    file: 'assets/audio/song_ending.mp3',
    from: 0, // 파일의 몇 초부터 틀지
    fadeIn: 1, // 처음에 소리가 커지는 시간(초)
    title: 'Cistus', // 엔딩 뒤 화면에 띄울 곡명
    artist: 'bangane',
    link: 'https://www.youtube.com/watch?v=IklVAP6DmJA',
    linkLabel: '유튜브에서 Cistus 듣기',
  },
  // 곡 파일이 없을 때 나레이션과 크레딧이 다 올라가는 데 걸리는 시간(초). 곡이 있으면 곡 길이에 맞춰요.
  rollSeconds: 37.5,
  albumCover: 'assets/album_cover.jpg',
  video: {
    mint: 'assets/video/clip_mint.mp4',
    tremble: 'assets/video/clip_tremble.mp4',
    membrane: 'assets/video/clip_membrane.mp4',
    swallow: 'assets/video/clip_swallow.mp4', // 있으면 먹혀 들어가는 장면 전체를 이 영상으로 대신해요
  },

  reduceShake: false, // true면 화면 흔들림을 크게 줄여요 (일시정지 화면에서 H로도 바꿀 수 있어요)
};
