# Motores SHM — independentes do Railway

Este diretório documenta o catálogo estático dos motores registrados no repositório.

A regra arquitetural é:

- **1 motor:** execução por backend standalone do próprio repositório, sem Railway.
- **2 ou mais motores:** comparação orquestrada pelo serviço Railway.
- **Railway não é a fonte dos motores.** Ele apenas executa o comparador multi-engine a partir deste mesmo código.

## Executar um único motor

No diretório `backend`:

```bash
python run_engine.py --engine segformer_public_crack --port 8001
```

Ou deixar o backend standalone aceitar qualquer motor registrado:

```bash
python run_engine.py --port 8001
```

Endpoints:

- `GET /health`
- `GET /engines`
- `POST /infer` com `file` e `engine_id`

O frontend do GitHub Pages pode apontar para esse backend local/customizado. Nenhuma inferência individual precisa passar pelo Railway.

## Catálogo

`catalog.json` é o catálogo estático usado também pelo frontend. O código de inferência permanece em `backend/app/adapters/`.
