from flask import Flask, request, jsonify,send_file
import edge_tts
from aiohttp import ClientError, WSServerHandshakeError
import asyncio
from pathlib import Path
import os,time,random
import tempfile
from waitress import serve



ROOT_DIR=Path(os.getcwd()).as_posix()
TMP_DIR=Path(tempfile.gettempdir()).as_posix()


app = Flask(__name__)


def generate_audio(data):
    async def _async_dubb(it):
        communicate_task = edge_tts.Communicate( text=it["text"], voice=it['voice'], rate=it['rate'], volume=it['volume'],pitch=it['pitch'])
        await communicate_task.save(it['filename'])
    try:
        asyncio.run(_async_dubb(data))
    except (ClientError,WSServerHandshakeError) as e:
        raise Exception('客户端连接错误，可能被微软限流')
    except Exception as e:
        raise Exception(e)

@app.route('/v1/audio/speech', methods=['POST'])
def audio_speech():
    """
    兼容 OpenAI /v1/audio/speech API 的接口
    """
    if not request.is_json:
        return jsonify({"error": "请求必须是 JSON 格式"}), 400

    data = request.get_json()

    # 检查请求中是否包含必要的参数
    if 'input' not in data or 'voice' not in data:
        return jsonify({"error": "请求缺少必要的参数： input, voice"}), 400
    

    text = data.get('input')
    
    voice = data.get('voice','zh-CN-XiaoxiaoNeural')
    
    volume = int((float(data.get('volume',1.0))-1)*100)
    volume=  f'+{volume}%' if volume>=0 else f'{volume}%'
    
    rate = int((float(data.get('speed',1.0))-1.0) *100)
    rate= f'+{rate}%' if rate>=0 else f'{rate}%'
    
    pitch = int(float(data.get('pitch',1.0))-1)
    pitch=f'+{pitch}Hz' if pitch>=0 else f'{pitch}Hz'
    
    filename=f'{TMP_DIR}/{len(text)}-{time.time()}-{voice}-{pitch}-{random.randint(1000,99999)}.mp3'
    try:
        itdata={"text":text,"voice":voice,"volume":volume,"rate":rate,"pitch":pitch,"filename":filename}
        print(f'{itdata=}')
        generate_audio(itdata)
        return send_file(filename, mimetype='audio/mpeg')
    except Exception as e:
        return jsonify({"error": {"message": f"{e}", "type": e.__class__.__name__, "param": f'speed={rate},voice={voice},input={text}', "code": 400}}), 500





if __name__ == '__main__':
    try:
        print(f'port is 7899')
        serve(app, host='0.0.0.0', port=7899)
    except Exception as e:
        import traceback
        traceback.print_exc()
