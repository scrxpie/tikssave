# scrapers/tiktok_scraper.py dosyanızda
import sys
import json
import asyncio
from TikTokApi import TikTokApi

async def get_tiktok_info(url):
    try:
        # OTURUM KİMLİĞİNİZİ BURAYA YAPIŞTIRIN
        # Bu değeri .env dosyanızdan almak daha güvenlidir.
        session_id = "verify_melwt3v2_TEIBvLEy_Fr9p_4y7a_A2nI_elNoJ1WIFxR4" 
        
        async with TikTokApi(custom_verifyFp="verify_fp_string_buraya_gelecek", session_id=session_id) as api:
            # video_id'yi URL'den doğru şekilde ayıklayın
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
                    "play": video.download_url,
                    "hdplay": video.hd_download_url,
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
    if len(sys.argv) > 1:
        url = sys.argv[1]
        asyncio.run(get_tiktok_info(url))
    else:
        print(json.dumps({"success": False, "message": "URL argümanı eksik."}))
