var posts=["2024/08/23/hello-world/","2024/08/23/第一次做静态博客界面/","2024/08/24/web前端/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };