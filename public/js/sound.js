// public/js/sound.js
// Gerenciador de Áudio com Web Audio API e reprodutor de música de fundo

class SoundManager {
  constructor() {
    this.audioCtx = null;
    this.bgMusic = null;
    this.musicVolume = 0.3;
    this.sfxVolume = 0.5;
    this.muted = false;

    // Música de fundo opcional (o usuário escolherá o arquivo depois)
    this.bgMusicPath = '/js/musica.mp3';
  }

  initAudio() {
    if (this.audioCtx) return;
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Iniciar a música de fundo se o elemento já não existir
    if (!this.bgMusic) {
      this.bgMusic = new Audio(this.bgMusicPath);
      this.bgMusic.loop = true;
      this.bgMusic.volume = this.muted ? 0 : this.musicVolume;

      // Capturar erros se o arquivo não existir ainda
      this.bgMusic.addEventListener('error', () => {
        console.warn(`Música de fundo '${this.bgMusicPath}' não encontrada. Insira o arquivo para tocar.`);
      });
    }
  }

  changeMusic(newPath) {
    if (this.bgMusicPath === newPath) return;
    this.bgMusicPath = newPath;

    if (this.bgMusic) {
      this.bgMusic.pause();
      this.bgMusic = null;
    }

    if (this.audioCtx) {
      this.bgMusic = new Audio(this.bgMusicPath);
      this.bgMusic.loop = true;
      this.bgMusic.volume = this.muted ? 0 : this.musicVolume;
      this.bgMusic.addEventListener('error', () => {
        console.warn(`Música de fundo '${newPath}' não encontrada. Insira o arquivo para tocar.`);
      });
      if (!this.muted) {
        this.bgMusic.play().catch(err => {
          console.log("Erro ao tocar nova música.", err);
        });
      }
    }
  }

  playMusic() {
    this.initAudio();
    if (this.bgMusic && !this.muted && this.bgMusic.paused) {
      this.bgMusic.play().catch(err => {
        console.log("Aguardando interação do usuário para tocar música.", err);
      });
    }
  }

  pauseMusic() {
    if (this.bgMusic) {
      this.bgMusic.pause();
    }
  }

  setMusicVolume(vol) {
    this.musicVolume = vol;
    if (this.bgMusic) {
      this.bgMusic.volume = this.muted ? 0 : vol;
    }
  }

  setSfxVolume(vol) {
    this.sfxVolume = vol;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.bgMusic) {
      this.bgMusic.volume = this.muted ? 0 : this.musicVolume;
      if (this.muted) {
        this.bgMusic.pause();
      } else {
        this.bgMusic.play().catch(() => { });
      }
    }
  }

  // --- SÍNTESE DE EFEITOS SONOROS (WEB AUDIO API) ---

  // Som de carta sendo distribuída (fricção rápida)
  playCardDealSound() {
    this.initAudio();
    if (this.muted || !this.audioCtx) return;

    const bufferSize = this.audioCtx.sampleRate * 0.15; // 0.15 segundos
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    // Ruído branco
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.audioCtx.createBufferSource();
    noise.buffer = buffer;

    // Filtro passa-banda para dar o som de "slide" de papel
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1000, this.audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1500, this.audioCtx.currentTime + 0.12);
    filter.Q.value = 3;

    // Envelope de volume
    const gainNode = this.audioCtx.createGain();
    gainNode.gain.setValueAtTime(this.sfxVolume * 0.4, this.audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.15);

    noise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.audioCtx.destination);

    noise.start();
  }

  // Som de carta batendo na mesa de madeira
  playCardPlaySound() {
    this.initAudio();
    if (this.muted || !this.audioCtx) return;

    // Oscilador de baixa frequência para simular o impacto
    const osc = this.audioCtx.createOscillator();
    const gainNode = this.audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, this.audioCtx.currentTime + 0.15);

    gainNode.gain.setValueAtTime(this.sfxVolume * 0.8, this.audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.18);

    // Filtro passa-baixo para deixar o impacto mais abafado (madeira)
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, this.audioCtx.currentTime);

    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.audioCtx.destination);

    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.2);
  }

  // Som de vitória (acorde maior e alegre)
  playVictorySound() {
    this.initAudio();
    if (this.muted || !this.audioCtx) return;

    const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
    const now = this.audioCtx.currentTime;

    notes.forEach((freq, idx) => {
      const osc = this.audioCtx.createOscillator();
      const gainNode = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.setValueAtTime(this.sfxVolume * 0.2, now + idx * 0.08);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.5);

      osc.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);

      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.6);
    });
  }

  // Efeito dramático para grito de truco
  playChantAlertSound() {
    this.initAudio();
    if (this.muted || !this.audioCtx) return;

    // Dois tons metálicos rápidos
    const now = this.audioCtx.currentTime;

    [300, 450].forEach((freq, idx) => {
      const osc = this.audioCtx.createOscillator();
      const gainNode = this.audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);

      gainNode.gain.setValueAtTime(this.sfxVolume * 0.15, now + idx * 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.1 + 0.25);

      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'peaking';
      filter.Q.value = 5;
      filter.frequency.setValueAtTime(1000, now);

      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);

      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.3);
    });
  }

  // Reproduz o áudio correspondente ao canto falado
  playVoiceChant(text, customConfig) {
    this.initAudio();
    if (this.muted) return;

    // Normaliza o texto removendo exclamações e passando para minúsculas
    const cleanText = text.replace(/¡|!/g, '').toLowerCase().trim();

    // Determinar a chave da ação correspondente para obter o pitch e o path
    let actionKey = '';
    if (cleanText === 'flor_sobre_envido') actionKey = 'flor_sobre_envido';
    else if (cleanText === 'retruco') actionKey = 'retruco';
    else if (cleanText === 'vale quatro' || cleanText === 'vale 4') actionKey = 'vale4';
    else if (cleanText === 'truco') actionKey = 'truco';
    else if (cleanText === 'real envido') actionKey = 'real_envido';
    else if (cleanText === 'falta envido') actionKey = 'falta_envido';
    else if (cleanText === 'envido') actionKey = 'envido';
    else if (cleanText === 'contra-flor e o resto' || cleanText === 'contra flor e o resto') actionKey = 'contra_flor_resto';
    else if (cleanText === 'contra-flor' || cleanText === 'contra flor') actionKey = 'contra_flor';
    else if (cleanText === 'flor') actionKey = 'flor';
    else if (cleanText === 'não quero' || cleanText === 'nao quero') actionKey = 'nao_quero';
    else if (cleanText === 'quero') actionKey = 'quero';
    else if (cleanText === 'achique') actionKey = 'achique';
    else if (cleanText === 'mazo' || cleanText === 'me vou ao mazo' || cleanText.includes('mazo')) actionKey = 'mazo';

    let path = '';
    let pitch = 1.0;

    // Se temos uma configuração customizada para essa ação
    if (customConfig && actionKey && customConfig[actionKey]) {
      path = customConfig[actionKey].path;
      pitch = parseFloat(customConfig[actionKey].pitch) || 1.0;
    }

    // Se não houver caminho customizado, determinar padrão
    if (!path) {
      if (!actionKey) {
        this.playChantAlertSound();
        return;
      }
      path = `/audio/${actionKey}.ogg`;
    }

    const audio = new Audio(path);
    audio.volume = this.sfxVolume;
    audio.playbackRate = pitch;
    audio.play().catch(err => {
      // Se o arquivo não existir, toca o som sintético como fallback
      console.warn(`Áudio para voz '${path}' não encontrado. Usando sintetizador.`);
      this.playChantAlertSound();
    });
  }
}

// Inicializar globalmente
window.soundManager = new SoundManager();
