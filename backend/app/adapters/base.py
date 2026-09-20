from abc import ABC,abstractmethod
from dataclasses import dataclass
from PIL import Image
import base64,io,time
from ..schemas import EngineResult
from ..taxonomy import apply_taxonomy
@dataclass
class AdapterMeta:
    id:str
    name:str
    family:str
    task:str
    description:str
    requires_weights:bool=False
    recommended:bool=False
    domain_mode:str="generic"
    source_url:str|None=None
    license:str|None=None
class EngineAdapter(ABC):
    meta:AdapterMeta
    def availability(self): return True,None
    def run(self,image:Image.Image):
        t=time.perf_counter()
        try:
            out=self.predict(image); out.latency_ms=(time.perf_counter()-t)*1000; return apply_taxonomy(out)
        except ModuleNotFoundError as e:
            return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="missing_dependency",latency_ms=(time.perf_counter()-t)*1000,message=str(e))
        except FileNotFoundError as e:
            return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="missing_weights",latency_ms=(time.perf_counter()-t)*1000,message=str(e))
        except Exception as e:
            return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="error",latency_ms=(time.perf_counter()-t)*1000,message=f"{type(e).__name__}: {e}")
    @abstractmethod
    def predict(self,image): ...
def png_b64(image):
    b=io.BytesIO(); image.save(b,format="PNG"); return base64.b64encode(b.getvalue()).decode()
