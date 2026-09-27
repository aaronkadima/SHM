import React from "react";
import{createRoot}from"react-dom/client";
import App from"./App";
import"./styles.css";

class AppErrorBoundary extends React.Component{
  constructor(props){super(props);this.state={error:null}}
  static getDerivedStateFromError(error){return{error}}
  componentDidCatch(error,info){console.error("SHM runtime error",error,info)}
  render(){
    if(!this.state.error)return this.props.children;
    return <main className="appRuntimeError" role="alert"><section><b>Falha ao carregar o SHM</b><p>{this.state.error?.message||String(this.state.error)}</p><button type="button" onClick={()=>window.location.reload()}>Recarregar</button></section></main>
  }
}
createRoot(document.getElementById("root")).render(<AppErrorBoundary><App/></AppErrorBoundary>);
