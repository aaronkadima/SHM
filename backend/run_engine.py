import argparse,os,uvicorn

def main():
    p=argparse.ArgumentParser(description="Executa um único backend de motor SHM sem Railway.")
    p.add_argument("--engine",required=False,help="ID do motor. Se omitido, o servidor aceita qualquer motor registrado, um por requisição.")
    p.add_argument("--host",default="127.0.0.1")
    p.add_argument("--port",type=int,default=8001)
    args=p.parse_args()
    if args.engine:
        os.environ["SHM_ENGINE_ID"]=args.engine
    uvicorn.run("app.standalone:app",host=args.host,port=args.port,reload=False)

if __name__=="__main__":
    main()
