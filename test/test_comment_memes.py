import importlib.util
from pathlib import Path
import tempfile
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image

MODULE = Path(__file__).resolve().parents[1] / 'vendor/bilibili-mcp/comment_memes.py'
spec = importlib.util.spec_from_file_location('comment_memes_test',MODULE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class CommentMemeTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        self.folder = Path(self.home.name)/'comment-memes'
        self.folder.mkdir()
        img = Image.new('RGB',(100,100),(255,255,255))
        img.save(self.folder/'奶龙大笑.png')
        img.save(self.folder/'另外一张.jpg')
        (self.folder/'假图片.png').write_text('not a real image')

    def test_list_only_reveals_names(self):
        self.assertIn('奶龙大笑',m.list_names(self.home.name))
        self.assertNotIn('../secrets',m.list_names(self.home.name))

    def test_select_validation(self):
        result=m.select_image(self.home.name,'奶龙大笑')
        self.assertEqual(result['type'],'image/png')
        for name in ('../secret','奶龙大笑.png','假图片','', 'nope'):
            with self.assertRaises(ValueError):m.select_image(self.home.name,name)

    def test_webp_visible_and_converts_before_upload(self):
        image = Image.new('RGBA',(32,32),(3,4,5,123))
        image.save(self.folder/'奶蛙疑惑.webp','WEBP')
        self.assertIn('奶蛙疑惑',m.list_names(self.home.name))
        selected=m.select_image(self.home.name,'奶蛙疑惑')
        self.assertEqual(selected['filename'],'奶蛙疑惑.png')
        self.assertEqual(selected['type'],'image/png')
        with Image.open(BytesIO(selected['data'])) as output:
            self.assertEqual(output.format,'PNG')
            self.assertEqual(output.size,(32,32))

    def test_webp_animated_uses_first_frame(self):
        images=[Image.new('RGB',(32,32),(i*150,0,0)) for i in (0,1)]
        images[0].save(self.folder/'奶龙跳舞.webp','WEBP',save_all=True,append_images=images[1:],duration=100,loop=0,lossless=True)
        result=m.select_image(self.home.name,'奶龙跳舞')
        with Image.open(BytesIO(result['data'])) as output:
            self.assertEqual(output.format,'PNG')
            self.assertEqual(getattr(output,'n_frames',1),1)
            self.assertEqual(output.getpixel((0,0)),(0,0,0))

    def test_symlink_not_read(self):
        folder=self.folder
        try:(folder/'隐私.png').symlink_to(Path(self.home.name)/'sensitive.png')
        except (OSError, NotImplementedError):self.skipTest('No symlink support')
        self.assertNotIn('隐私',m.list_names(self.home.name))

    def test_per_day_and_round_limits(self):
        used=set()
        self.assertEqual(m.reserve_attempt(self.home.name,2,1,used),'reserved')
        self.assertEqual(m.reserve_attempt(self.home.name,2,1,used),'round_limit')
        self.assertEqual(m.reserve_attempt(self.home.name,2,2,set()),'reserved')
        self.assertEqual(m.reserve_attempt(self.home.name,2,2,set()),'daily_limit')

    def test_daily_limit_above_twenty_and_round_still_separate(self):
        counter=set()
        for _ in range(25):
            self.assertEqual(m.reserve_attempt(self.home.name,100,25,counter),'reserved')
        self.assertEqual(m.reserve_attempt(self.home.name,100,25,counter),'round_limit')
        self.assertEqual(m.reserve_attempt(self.home.name,25,30,set()),'daily_limit')

    def test_mcp_quota_configuration_accepts_above_twenty(self):
        # 加载真实 MCP 文件里的配置函数，不要求启动 MCP 或联网。
        import ast
        import os
        root=MODULE.with_name('mcp_server.py')
        tree=ast.parse(root.read_text('utf8'))
        fn=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='_comment_meme_config')
        scope={'os':os}
        exec(compile(ast.Module(body=[fn],type_ignores=[]),str(root),'exec'),scope)
        with patch.dict(os.environ,{'BILI_COMMENT_MEMES_ENABLED':'1','BILI_COMMENT_MEMES_PER_DAY':'999',
                                    'BILI_COMMENT_MEMES_PER_ROUND':'3'}):
            self.assertEqual(scope['_comment_meme_config'](),(True,999,3))
        with patch.dict(os.environ,{'BILI_COMMENT_MEMES_PER_DAY':'999999'}):
            self.assertEqual(scope['_comment_meme_config']()[1],10000)

    def test_no_auto_retry_and_form_attachments(self):
        img=m.select_image(self.home.name,'奶龙大笑')
        cred=SimpleNamespace(sessdata='S',bili_jct='C')
        with patch.object(m,'_post_json',return_value={'code':0,'data':{'image_url':'https://i0.hdslb.com/bfs/new_dyn/x.png',
                           'image_width':100,'image_height':100,'img_size':3}}) as fn:
            rec=m.upload_image(img,cred)
            self.assertEqual(rec['img_width'],100)
            self.assertIn('upload_bfs',fn.call_args.args[0])
        with patch.object(m,'_post_json',return_value={'code':0,'data':{'rpid':123}}) as fn:
            data=m.send_with_image('BV1EopJ6LEth',123,'哈哈',cred,rec,[{'name':'朋友','uid':'123456'}])
            self.assertEqual(data['data']['rpid'],123)
            form=fn.call_args.args[1].decode('utf8')
            self.assertIn('pictures=',form)
            self.assertIn('at_name_to_mid=',form)

    def test_untrusted_upload_url_rejected(self):
        img=m.select_image(self.home.name,'奶龙大笑')
        cred=SimpleNamespace(sessdata='S',bili_jct='C')
        with patch.object(m,'_post_json',return_value={'code':0,'data':{'image_url':'https://attacker.invalid/bfs/x.png'}}):
            with self.assertRaises(ValueError):m.upload_image(img,cred)


if __name__=='__main__':unittest.main()

class CategorizedCommentMemeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'comment-memes'
        for folder in ('奶娃', '其他', '大模型娘化素材', '奶娃/经典表情'):
            (self.root / folder).mkdir(parents=True,exist_ok=True)
        pic=Image.new('RGBA',(40,40),(0,200,40,255))
        pic.save(self.root/'奶娃'/'奶龙大笑.webp','WEBP')
        pic.save(self.root/'其他'/'奶龙大笑.PNG','PNG')
        pic.save(self.root/'奶娃'/'经典表情'/'奶龙无语.png','PNG')
        pic.convert('RGB').save(self.root/'大模型娘化素材'/'角色震惊.jpg','JPEG')

    def test_nested_names_and_select_exact_category(self):
        names=m.list_names(self.temp.name)
        self.assertIn('奶娃/奶龙大笑',names)
        self.assertIn('其他/奶龙大笑',names)
        self.assertIn('奶娃/经典表情/奶龙无语',names)
        self.assertEqual(m.select_image(self.temp.name,'奶娃/奶龙大笑')['type'],'image/png')
        self.assertEqual(m.select_image(self.temp.name,'其他/奶龙大笑')['type'],'image/png')
        self.assertEqual(m.select_image(self.temp.name,'其他/奶龙大笑')['filename'],'奶龙大笑.PNG')
        self.assertEqual(m.select_image(self.temp.name,'奶娃/经典表情/奶龙无语')['name'],'奶娃/经典表情/奶龙无语')
        category=m.list_library(self.temp.name,category='奶娃')
        self.assertEqual(category['shown'],2)
        self.assertNotIn('其他/奶龙大笑',category['names'])
        self.assertEqual(category['total'],4)

    def test_malicious_path_and_symlink_folders_blocked(self):
        for name in ('../secret', '奶娃/../secret', '/奶娃/奶龙大笑', '奶娃\\奶龙大笑',
                     '奶娃/奶龙大笑.webp', 'C:/奶娃/奶龙大笑', '奶娃//奶龙大笑', '奶娃/./奶龙大笑'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                m.select_image(self.temp.name,name)
        try:
            (self.root/'泄漏').symlink_to(Path(self.temp.name),target_is_directory=True)
        except (OSError,NotImplementedError):
            self.skipTest('filesystem has no symlinks')
        self.assertFalse(any(x.startswith('泄漏/') for x in m.list_names(self.temp.name)))

    def test_ambiguous_names_in_same_folder_are_hidden(self):
        pic=Image.new('RGB',(40,40),(255,0,0))
        pic.save(self.root/'奶娃'/'奶龙大笑.png')
        self.assertNotIn('奶娃/奶龙大笑',m.list_names(self.temp.name))
        self.assertIn('其他/奶龙大笑',m.list_names(self.temp.name))
        with self.assertRaises(ValueError):
            m.select_image(self.temp.name,'奶娃/奶龙大笑')
