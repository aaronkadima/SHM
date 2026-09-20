# Implantação 100% online

A plataforma foi preparada para uso sem Docker local.

## 1. Frontend — GitHub Pages

O workflow `.github/workflows/pages.yml` compila `frontend/` e publica o site no GitHub Pages a cada push no `main`.

No GitHub, habilite uma única vez:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

A URL esperada é:
`https://aaronkadima.github.io/SHM/`

O frontend aceita a URL do backend de duas formas:
1. variável do repositório `VITE_API_URL`; ou
2. pelo campo **Backend de inferência** na própria página. A URL fica salva no navegador.

## 2. Backend — Railway

O backend precisa de um servidor real porque GitHub Pages é hospedagem estática e não executa FastAPI/PyTorch.

No Railway, conecte o repositório `aaronkadima/SHM` e configure o serviço com:
- Root Directory: `/backend`
- Dockerfile detectado automaticamente: `backend/Dockerfile`
- Healthcheck: `/health`
- Gere um domínio público HTTPS.
- Variável `CORS_ORIGINS=https://aaronkadima.github.io`

O Docker é construído no servidor do Railway; nada precisa ser instalado no computador local.

Depois, copie o domínio Railway (por exemplo `https://...up.railway.app`) no campo **Backend de inferência** da página GitHub Pages.

## 3. Motores pesados/GPU

A imagem CPU básica executa os motores instalados em `backend/requirements.txt`. Detectron2, SAM2, MMDetection/MMSegmentation, SuperGradients e Anomalib possuem dependências opcionais e checkpoints próprios. Para esses motores, use uma instância com memória suficiente e, preferencialmente, GPU. Os adapters informam claramente quando dependência ou pesos estão ausentes.

Os checkpoints não são colocados no Git por padrão. Configure-os no volume/armazenamento do backend e defina as variáveis descritas em `models/README.md`.

## 4. Atualizações

Push em `main`:
- GitHub Pages recompila o frontend automaticamente.
- O provedor do backend pode ser configurado para autodeploy a partir do mesmo repositório.
