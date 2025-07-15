const onvif = require('node-onvif');
const readline = require('readline');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const express = require('express');

// Configurações da câmera
const cameraConfig = {
  xaddr: 'http://192.168.15.6:80/onvif/device_service',
  user: 'admin',
  pass: '********'
};

const rtspUrl = 'rtsp://admin:Abcd321$@192.168.15.6:554/cam/realmonitor?channel=1&subtype=0';

const baseDir = path.join(__dirname, 'gravacoes');
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.input.setRawMode(true);
rl.input.resume();

let gravacao = null;
let gravando = false;
let tempoInicio = null;
let tempoInterval = null;
let arquivoAtual = null;

function getDataAtual() {
  return new Date().toISOString().slice(0, 10);
}

function getTimestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
}

function criarPastaData() {
  const pasta = path.join(baseDir, getDataAtual());
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
  return pasta;
}

function logMensagem(msg) {
  const logFile = path.join(baseDir, 'log_gravacoes.txt');
  const linha = `${new Date().toISOString()} - ${msg}\n`;
  fs.appendFile(logFile, linha, err => {
    if (err) console.error('Erro ao salvar log:', err.message);
  });
}

function capturarImagem(outputFile) {
  return new Promise((resolve, reject) => {
    exec(`ffmpeg -y -rtsp_transport tcp -i "${rtspUrl}" -frames:v 1 "${outputFile}"`, (err) => {
      if (err) reject(err);
      else resolve(outputFile);
    });
  });
}

async function main() {
  console.log('🔄 Conectando à câmera...');
  const device = new onvif.OnvifDevice(cameraConfig);

  try {
    await device.init();
    console.log('✅ Conectado com sucesso!\n');

    const profile = device.getCurrentProfile();
    if (!profile.ptz) {
      console.error('❌ Perfil atual não possui suporte PTZ.');
      process.exit(1);
    }

    console.log('--- Controle da Câmera ---');
    console.log("  'a' = ESQUERDA   | 'd' = DIREITA");
    console.log("  'w' = CIMA       | 'x' = BAIXO");
    console.log("  'z' = ZOOM IN    | 'c' = ZOOM OUT");
    console.log("  'p' = PRINT      | 'r' = GRAVAR");
    console.log("  't' = PARAR GRAVAÇÃO | 's' = PARAR MOVIMENTO");
    console.log("  'q' = SAIR");
    console.log('--------------------------');

    rl.input.on('keypress', async (chunk, key) => {
      if (!key || !key.name) return;

      try {
        switch (key.name) {
          case 'a':
            console.log('⬅  Movendo para ESQUERDA...');
            await device.ptzMove({ speed: { x: -0.2, y: 0, z: 0 } });
            setTimeout(() => device.ptzStop(), 1000);
            break;
          case 'd':
            console.log('➡  Movendo para DIREITA...');
            await device.ptzMove({ speed: { x: 0.2, y: 0, z: 0 } });
            setTimeout(() => device.ptzStop(), 1000);
            break;
          case 'w':
            console.log('⬆  Movendo para CIMA...');
            await device.ptzMove({ speed: { x: 0, y: 0.2, z: 0 } });
            setTimeout(() => device.ptzStop(), 1000);
            break;
          case 'x':
            console.log('⬇  Movendo para BAIXO...');
            await device.ptzMove({ speed: { x: 0, y: -0.2, z: 0 } });
            setTimeout(() => device.ptzStop(), 1000);
            break;
          case 'z':
            console.log('🔍 Zoom IN...');
            await device.ptzMove({ speed: { x: 0, y: 0, z: 0.05 } });
            setTimeout(() => device.ptzStop(), 1000);
            break;
          case 'c':
            console.log('🔎 Zoom OUT...');
            await device.ptzMove({ speed: { x: 0, y: 0, z: -0.05 } });
            setTimeout(() => device.ptzStop(), 1000);
            break;
          case 'p':
            console.log('📸 Capturando imagem...');
            const outputFile = path.join(__dirname, `print_${Date.now()}.jpg`);
            try {
              const file = await capturarImagem(outputFile);
              console.log('✅ Print salvo em:', file);
            } catch (err) {
              console.error('❌ Erro ao capturar print:', err.message);
            }
            break;
          case 'r':
            if (!gravando) {
              const pastaData = criarPastaData();
              arquivoAtual = path.join(pastaData, `gravacao_${getTimestamp()}.mp4`);
              console.log('🔴 Iniciando gravação em:', arquivoAtual);
              logMensagem(`Início gravação: ${arquivoAtual}`);

              gravacao = spawn('ffmpeg', [
                '-y',
                '-rtsp_transport', 'tcp',
                '-i', rtspUrl,
                '-an',
                '-vcodec', 'libx264',
                '-preset', 'ultrafast',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                arquivoAtual
              ], {
                stdio: ['pipe', 'ignore', 'pipe']
              });

              gravacao.stderr.on('data', data => {
                console.log(`[FFmpeg] ${data}`);
              });

              gravando = true;
              tempoInicio = Date.now();

              tempoInterval = setInterval(() => {
                const duracao = Math.floor((Date.now() - tempoInicio) / 1000);
                process.stdout.write(`\r⏺ Tempo de gravação: ${duracao}s `);
              }, 1000);

              gravacao.on('close', (code) => {
                clearInterval(tempoInterval);
                gravando = false;
                process.stdout.write('\n');
                console.log(`🛑 Gravação finalizada (código ${code}).`);
                logMensagem(`Finalização gravação: ${arquivoAtual}`);
              });

              gravacao.on('error', (err) => {
                console.error('⚠ Erro no processo de gravação:', err.message);
                gravando = false;
                clearInterval(tempoInterval);
              });
            } else {
              console.log('⚠ Gravação já em andamento.');
            }
            break;

          case 't':
            if (gravando && gravacao) {
              console.log('🛑 Encerrando gravação...');
              if (gravacao.stdin) {
                gravacao.stdin.write('q');
                gravacao.stdin.end();
              } else {
                gravacao.kill('SIGINT');
              }
            } else {
              console.log('⚠ Nenhuma gravação em andamento.');
            }
            break;

          case 's':
            console.log('⏹  Parando movimento...');
            await device.ptzStop();
            break;
          case 'q':
            console.log('👋 Saindo...');
            if (gravando && gravacao) {
              console.log('🛑 Encerrando gravação antes de sair...');
              gravacao.kill('SIGINT');
            }
            await device.ptzStop();
            rl.close();
            process.exit(0);
            break;
        }
      } catch (err) {
        console.error('⚠ Erro ao executar comando:', err.message);
      }
    });

    rl.on('close', () => console.log('Interface encerrada.'));

  } catch (error) {
    console.error('❌ Erro ao conectar/controlar a câmera:', error.message);
    process.exit(1);
  }
}

// --- Servidor Express ---
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  try {
    const pastas = fs.readdirSync(baseDir).filter(f => {
      const fullPath = path.join(baseDir, f);
      return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
    });

    let html = '<h1>Vídeos gravados</h1>';
    pastas.forEach(pasta => {
      html += `<h2>${pasta}</h2><ul>`;
      const pastaCompleta = path.join(baseDir, pasta);
      const arquivos = fs.readdirSync(pastaCompleta);

      arquivos.filter(a => a.endsWith('.mp4')).forEach(arquivo => {
        html += `
          <li>
            <strong>${arquivo}</strong><br/>
            <video width="480" controls>
              <source src="/videos/${pasta}/${arquivo}" type="video/mp4">
              Seu navegador não suporta vídeo.
            </video><br/>
            <a href="/videos/${pasta}/${arquivo}" download>📥 Baixar MP4</a>
          </li>
        `;
      });

      html += '</ul>';
    });

    res.send(html);
  } catch (err) {
    res.status(500).send('Erro ao gerar a página: ' + err.message);
  }
});

app.use('/videos', express.static(baseDir));
app.listen(port, () => {
  console.log(`🖥 Servidor rodando: http://localhost:${port}`);
});

main();
