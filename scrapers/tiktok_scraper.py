import sys
import json
from TikTokApi import TikTokApi

async def get_tiktok_info(url):
    try:
        api = TikTokApi()
        video_id = url.split('/')[-1].split('?')[0]
        video = await api.video(id=video_id).info()
        
        info = {
            "success": True,
            "data": {
                "id": video.id,
                "author": {
                    "unique_id": video.author.unique_id,
                    "nickname": video.author.nickname,
                    "avatar": video.author.avatar,
                },
                "title": video.desc,
                "cover": video.cover_url,
                "play": video.download_url, # Filigransız
                "hdplay": video.hd_download_url, # HD ve filigransız
                "music": video.music.play_url,
                "play_count": video.stats.play_count,
                "digg_count": video.stats.digg_count,
                "comment_count": video.stats.comment_count,
                "share_count": video.stats.share_count,
                "create_time": video.create_time,
            }
        }
    except Exception as e:
        info = {
            "success": False,
            "message": f"Hata: {str(e)}"
        }

    print(json.dumps(info))
    
if __name__ == "__main__":
    import asyncio
    if len(sys.argv) > 1:
        url = sys.argv[1]
        asyncio.run(get_tiktok_info(url))
    else:
        print(json.dumps({"success": False, "message": "URL argümanı eksik."}))
