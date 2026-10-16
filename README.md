for backend folder to run 
only open main folder in terminal of vs code 
cd:/HydroTwin
and then 

these cmds 

python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac/Linux
pip install fastapi uvicorn pydantic numpy pandas scipy scikit-learn joblib rasterio geopandas shapely pyogrio



Running

From the HydroTwin folder (the one that contains backend) with the venv activated:

uvicorn backend.main:app --reload

Open http://127.0.0.1:8000/docs to test the API interactively.





FOR FRONTEND

open the terminal in the FRONTEND folder and then rUN NPM I 
and after that run npm run dev 
and then enjoy and tell me the updates thank u so we can go to the other modules as our main work is done if needed something do let me know
