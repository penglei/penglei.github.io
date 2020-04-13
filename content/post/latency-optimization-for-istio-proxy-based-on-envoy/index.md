---
title: "Istio proxy性能优化阶段总结"
date: 2020-02-28T17:43:24+08:00
lastmod: 2020-02-28T17:43:24+08:00
draft: false
keywords: []
description: ""
tags: [C++]
categories: [servicemsh]
author: "penglei"

comment: false
toc: true
autoCollapseToc: false
postMetaInFooter: false
hiddenFromHomePage: false
contentCopyright: false
reward: false
mathjax: false
mathjaxEnableSingleDollar: false
mathjaxEnableAutoNumber: false

hideHeaderAndFooter: false

#enableOutdatedInfoWarning: false

flowchartDiagrams:
  enable: false
  options: ""

sequenceDiagrams:
  enable: false
  options: ""

---

2017下半年，非侵入式微服务架构迅速吸引开发者眼球， ServiceMesh 进入飞速发展通道，至今已近三年。
这中间，各路势力迅猛崛起，第一代服务网格框架Linkerd还未普及就被淘汰，2017年5月，新生的Istio迅速抢占了大部分关注ServiceMesh的开发者的目光。
随后，Istio快速迭代，只经历了14个月便从0.1进化到1.0版本，这赶上了Kubernetes崛起时的迭代速度。我们在TKE容器产品上，基于Istio开发了TKE Mesh，帮助用户在云上更加容易地使用ServiceMesh架构。

<!--more-->

## 背景动机

<!--
从2018年7月到现在，Istio没能复制Kubernetes高速发展的情形，反而各种ServiceMesh框架如雨后春笋般出现。虽然Istio继续保持着绝对影响力，但它没有成为事实标准，很多用户亦一直处于对其调研的过程中，我们不得不接受这样的现状：引领ServiceMesh的Istio处于叫好不叫座的境地，没有被普遍接受使用。
-->

除了复杂性，「性能不好」可能是用户不敢大规模使用Istio架构的关键因素。Istio社区和官方都对性能进行了一些测试，对其性能同样不太满意， 更是加重了大家对Istio甚至ServiceMesh的观望态度。
在阅读了一些测试报告和文章时，我们发现很难深刻理解Istio性能问题的原因。Istio官方博客中对性能测试报告描述过于简单。
在1.5版本以前的《performance-and-scalability》文章的描述中，数据面sidecar给服务间调用增加了6ms的延迟。
直观上，我们觉得这样的性能损耗过大，有点不可思议。 通过对社区和官方的测试报告进行定性分析之后，我们发现Istio数据面代理对服务间调用的延时影响较大可能已经形成共识，
较大的延时同时意味着它很可能消耗了过多的CPU资源，对吞吐量（QPS）也将造成影响。 因此，我们希望更细致地测试分析Istio数据面性能，得到一些有价值的经验和数据指标，为优化TKE Mesh提供一些指引。



## 架构简介

Istio在设计上分为了控制面和数据面。
控制面可以理解为各种配置管理和协调服务。比如，控制面自动从Kubernetes中提取Service信息，使用xDS协议将其下发到数据面，帮助数据面代理完成服务发现。Mixer同样被划分为控制面组件，它既是一个执行授权策略的服务，也是数据面遥测信息的集散中心。

![Istio架构][istio-structure]

_图1: Istio架构示意图_

Istio数据面完成了流量管理、遥测信息收集的任务。数据面以sidecar模式实现，这是Istio为微服务带来强大能力却不用修改服务本身的关键：即在每一个服务实例旁，它都会运行一个envoy代理程序，将原来需要在服务内实现（如服务发现、负载均衡、监控追踪等）的功能移到独立进程中完成。

![数据面示意][data-plane-diagram]

_图2: 在Kubernetes平台上，Pod内增加了一个运行着envoy代理的容器，服务流量需通过envoy进行转发_

注： 对于接下来的性能研究，文中出现的术语 proxy、sidecar、envoy可以视为同一个意思。

## 性能测试

Istio本身架构比较复杂，作为性能研究领域的门外汉，面对这样的复杂系统，如何下手是第一个问题。 一开始，我们便带着两个问题进行思考：

* 性能的定义是什么，如何衡量istio性能好与不好？
* istio性能不好有具体的应用场景和问题表现吗？

吞吐量上不去、延时高、消耗CPU资源过多都是性能问题，这些问题可能是独立的，也可能相互之间有内在联系。
终端用户体验是否友好的的核心因素之一是延时。Istio的核心能力是管理微服务架构，数据面sidecar会给服务调用增加一些延时，
随着业务的发展，企业的微服务可能会变得异常复杂，虽然每个sidecar只增加一点点延时，但随着调用链路深度的增加，叠加的延时可能会达到无法接受的地步。
因此我们更关心sidecar对服务间调用产生的影响，它将最终影响服务质量。
istio数据面有作为ingressgateway的envoy，也有作为sidecar管理服务间流量的envoy代理。两者有明显区别，前者可能面对高并发问题，需要处理大量连接，每个连接接只有少量的请求，
而后则恰恰相反，常常使用长连接进行完成RPC过程。我们先聚焦于研究sidecar对服务间调用带来的潜在高延时问题，作为接入层的ingressgateway暂时不作考虑。


### 工具与方法

测试sidecar带来的延时影响，需要注意各种变量和干扰因素。例如：

+ 选择合适的模拟服务来进行压测

    istio 社区有bookinfo例子，linkerd使用emojivoto作为模拟服务进行性能测试。
    bookinfo和emojivoto本身消耗资源很多，处理请求的时间较长。当我们对envoy进行调优时，通过e2e测量延时来确认优化效果，
    但模拟服务本身高延时的正常波动可能会掩盖envoy调优的差异，导致难以确认优化是否合理。因此我们单独实现了一个简单的HTTP服务mesh-mocker，
    它接收到请求之后，回传Request Body，同时将HTTP Request Headers编码为json字符串追加到Response Body中。

+ 不同组件互相影响

    Istio控制面的组件Mixer消耗资源较多，测试过程中需保证它不占用压测工具和模拟服务的资源。

+ Istio功能取舍

    如果开启TLS加密流量，数据面必将消耗更多CPU资源；Check策略会同步调用远端服务，导致延时明显增加。我们在测试中都将这些功能关闭。

+ 需要深入理解压测工具的模型

    压测工具的线程模型、发包模型也有区别，比如fortio使用gorouting来进行并发，适合模拟大量连接的场景；
    大多数压测工具有Coordinated Omission问题，导致压测报告的结果比实际环境中要好；
    压测工具如果使用带GC语言的实现，可能也会影响测量时间的精度，导致结果不稳定。

#### Coordinated Omission 问题

什么是Coordinated Omission？简单地说就是我们进行压测时，可能只是测量了「服务时间」，忽略了「排队等待时间」。而真实用户体验到的延时是「响应时间」，包含了「服务时间」与「排队等待时间」之和。

![OC Problem][oc-problem-graph]

*图中queue只是一种抽象，例如它可以来源于链路中的buffer，并发系统中的资源竞争等*

压测工具通常没有处理OC问题，它们大多定时发送一个请求，记录开始时间(`begin_time`)，然后接收响应并记录结束时间(`end_time`)，这样便得到一个请求的延时(`end_time - start_time`)。
当新的发送周期到来时，继续发送下一个请求，记录延时，如此循环...

这种发包策略下当某个请求出现响应过慢，其响应时间点已经超过下一个发包周期开始时间点，导致压测工具延后了原本应该发送的请求，降低了实际测试RPS。
最终，我们测量的数据中只有少部分请求的延时增加了（发生阻塞的那些请求），而真实环境中则可能有多个排队中的请求因为前面的请求阻塞而出现延时增加，
用户体验到响应变慢的概率比压测环境报告的数据更大！

![OC Problem latency comparing][hdr-oc-problem]

*图片来自: https://bravenewgeek.com/tag/coordinated-omission/*

解决OC问题有多种策略，压测工具不等待先前请求响应而是直接定时发送请求(nighthawk中的open-loop模式即是如此)，也可以在出现响应延时增大后加快发送频率（wrk2使用的方法），还可以在数据处理时进行拟合补充，其目的都是为了让压测得到的数据更接近用户真实环境。

#### 压测工具

社区有非常多压测工具，如ab, jmeter, fortio, wrk2... 我们最终选择了Envoy官方开发的 [`nighthawk`](https://github.com/envoyproxy/nighthawk) 。
nighthawk由在性能测试领域具有丰富经验的工程师所开发，它还具有诸多优点：

+ 开源可扩展，容易进行二次开发
+ 支持HTTP2，可以进行grpc压力测试
+ 具有非常好的时间精度和伸缩性
+ 基于envoy实现，没有GC的影响
+ 可以非常均匀地发送请求，支持open-loop和closed-loop两种模式

#### 自动化脚本

在调优测试过程中，我们会不停地进行 `假设-->开发-->测试-->数据对比-->再假设` 循环，因此，开发好自动化脚本，
将每一次测试用例的参数，环境，结果等信息进行记录保存是非常必要的，否则在大量的测试之后，我们很快就会迷失在各种测试用例的数据中。

测试过程需要调整sidecar的yaml配置参数，包括envoy镜像地址、资源、启动参数等等，甚至还需要增加挂载host目录来保存envoy打点数据。
修改这些配置是一个麻烦的事情，因为相应的yaml配置都是由istio通过模板render生成。虽然我们可以直接修改模板来实现对测试参数的修改，
但这会有非常多的缺点:

+ 不同的istio版本需要分别修改，管理复杂；
+ 模板中增加的配置需要注入render时的参数，这些参数值在注入sidecar时如何传递进去非常麻烦，甚至需要修改自动注入组件；

我们采取另外的方案来实现：通过istioctl完成本地注入生成yaml，再使用kustomize对yaml文件进行结构化修改，得到最终运行测试的Kubernetes yaml文件。

例如，修改sidecar中envoy镜像地址，可以通过如下的 transformer 实现:
````yaml
apiVersion: builtin
kind: ImageTagTransformer
metadata:
  name: imagetag_not_important_b
imageTag:
  name: istio/proxyv2
  newName: ccr.ccs.tencentyun.com/mesh-perf/istio-proxy-v2
  newTag: 1.3.6
````
*sidecar_image_transformer.yaml*

````yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
- resource-sidecar-injected.yaml
transformers:
- sidecar_image_transformer.yaml
````
*kustomization.yaml*

kustomize 支持插件，某些操作内置的plugin无法完成，可以通过自定义plugin实现。
例如，下面的yaml格式内容描述了对istio-proxy容器进行添加initContainer、修改security、删除resource limits等操作。
这些yaml内容使用的是json patch规范，在自定义的kustomize plugin中，我们将其转变为json格式之后，使用[json-patch][golang-json-patch]工具执行对istio-proxy容器配置的修改操作。

````yaml
- op: add
  path: ${proxy_container_path}/securityContext/privileged
  value: true
- op: add
  path: ${proxy_container_path}/securityContext/allowPrivilegeEscalation
  value: true
- op: replace
  path: ${proxy_container_path}/imagePullPolicy
  value: Always
- op: remove
  path: ${proxy_container_path}/resources/limits
- op: add
  path: ${proxy_container_path}/volumeMounts/-
  value:
    mountPath: /data
    name: statistic-data
- op: add
  path: /spec/template/spec/initContainers/-
  value:
    args:
    - -c
    - "mkdir -p /data/tmp; chmod -R 777 /data/tmp; chown -R 1337 /data/tmp"
    command:
    - /bin/sh
    image: ubuntu:xenial
    imagePullPolicy: IfNotPresent
    name: create-host-data-dir
    resources: {}
    securityContext:
      privileged: true
      runAsNonRoot: false
      runAsUser: 0
    volumeMounts:
    - mountPath: /data
      name: statistic-data
````
*`${proxy_container_path}`是istio-proxy容器的文档对象路径，通常是 `/spec/template/spec/containers/1`*

最后，整个测试脚本按下面的流程进行实现：

* 安装Istio
* 使用Istioctl注入本地yaml(如客户端nighthawk yaml，服务端 mesh-mocker yaml)；
* 使用kustomize修改yaml中的istio-proxy配置；
* 提交修改后的yaml到Kubernetes集群运行；
* 收集测试节点的数据（延迟和envoy打点日志）；
* 删除nighthawk和mesh-mocker，清理环境；

#### 环境

测试环境使用5台8C16G节点的tke集群。
istio-telmetry组件消耗的资源较多，服务端mixs消耗较多，数据面每1000QPS时，mixs大概消耗1.2vCPU，因此使用两个节点，以满足超过7000QPS的测试压力；
pilot等其它控制面组件使用一个节点进行部署； nighthawk和mesh-mocker分别占用一个节点。自动化脚本打包在一个镜像中，每次在控制面组件所在节点运行。

测试中限制了nighthawk、mesh-mocker、envoy都使用2vCPU。同时，考虑到相同资源下，多核机器上worker线程数对并发度有直接影响，最终也会影响延时，
因此我们对每个组件的工作线程数也限制为2。这样配置后，在OS调度下，几乎所有组件都是独立运行，不会互相影响，更容易评估使用Istio后envoy产生的影响。

![测试环境][test-env]

### Envoy打点

Istio数据面带来了明显的延时，把消息在链路中各个阶段的延时统计出来，是进行优化的重要依据。
一开始我们思考利用内核态工具如bpftrace进行分析，但请求消息在envoy中进行了多次转发，内核态很难追踪应用层会话，统计时间并不方便，
因此我们决定在envoy内部打点记录时间，测试结束后通过离线脚本计算消息在envoy中进行处理的延时。

![envoy内部打点][envoy-record-time]

client请求server是，每条消息Request依次经过envoy中的`3`，`4`，`5`，`6`几处，通过readv和writev系统调用读取或发送消息，Response以相反的顺序经过envoy。

我们将Request经过打点位置的时间戳记录为`t(*)`，将Response经过的时间戳记录为`t'(*)`，
则一条消息在两个sidecar(envoy)中消耗的时间总计为：`t(4)-t(3) + t'(3)-t'(4) + t(6)-t(5) + t'(5)-t'(6)`。

为了防止打点带来过多的额外损耗，时间戳直接记录在预分配的连续内存（数组）中，如果使用1w QPS测试10分钟，每个envoy最多占用280MB内存，我们增加了istio-proxy容器的内存资源配置，以保存这些时间戳数据。
时间戳应该记录在内存中什么具体位置呢？这是通过给每条消息增加唯一`x-idx`作为其数组下标实现的，每条消息的打点时间戳直接写入指定位置内存，非常高效。

### 测试结果

envoy延时分布

![Envoy延时分布][envoy-latency-distribution]

我们使用2000QPS进行测试，利用Envoy打点得到了上面的延时分布。从这个分布中，我们发现了一个关键信息：图中`1ms ~ 2ms`之间的延时分布有隆起现象。
高延时部份应该是一些长尾请求造成，应该符合典型的幂律分布，但测试结果表明Envoy造成的延时分布不符合这个特征！

### 分析优化

经过一些测试之后，我们发现测试过程中CPU资源是Envoy的性能瓶颈，遂猜测Envoy里面有某种任务在长时间运行，来不及转发in-flight的消息，造成这些消息转发不及时。
随后，我们对高延时部份的数据在时间分布上进行分析，发现其分布较均匀，因此将目光转移到一些周期性运行的定时任务上。
在对Envoy(istio-proxy)代码进行分析后，我们发现istio遥测功能(mixer)在sidecar中会消耗较多的CPU，符合猜测:

* 属性提取中有大量的map操作和字符串拷贝操作

    ![mixer map operation][istio-mixer-attribute-building]

* 为了节省网络带宽，envoy中对属性上报进行批量处理并压缩

    ![][istio-mixer-attribute-batch-compress]

结合envoy的多线程架构，mixer这种实现方式会造成worker忙于处理上报遥测工作，阻塞业务消息的转发，造成一些请求延时明显增加:

![][envoy-worker-structure]

分析出问题原因之后，我们采用如下的方案进行优化：

* 在Envoy中增加独立的AsyncWorker，专门处理占用CPU但不紧急的逻辑；
* AsyncWorker线程以低优先级运行（SCHED\_IDLE），使其随时可被抢占；
* Worker保存任务上下文，将其提交到队列中暂存，AsyncWorker定时拉取处理；
* 任务队列实现保证lock-free及unbounded特性，防止意外阻塞Worker线程；

![][async-worker-report]

经过优化之后，Envoy内部的延时分布有明显改善：

![][envoy-latency-optimized-distribution]

总体延时也有一些改善：

![][e2e-latency-optimized-compare]

通过异步化处理遥测上报操作，我们虽然在延时上获得了明显的优化，
但对envoy占用的CPU资源却没有改善，这对大部份应用来说还是不可接受的，
随着mixer-less的落地，我们将优化方向转移到降低Envoy CPU消耗，
在下一个tke-mesh版本中提供一个性能更好的sidecar。
当前的AsyncWorker架构则可以作为通用组件继续保留，与以后的优化进行融合，
以达到最低的延时。


## Istio数据测试对比(已更新，包含1.5遥测)

我们测试了以下几种情况:

* baseline

  没有sidecar。测试用的模拟服务是简单的HTTP echo 服务，延时比较稳定，对比baseline可评估引入sidecar后增加的延时。

* 1.3-no-telemetry

  关闭了遥测功能，sidecar只做流量转发功能，这时候我们丧失了istio带来的「可观察性」能力。

* 1.3-mixer-telemetry

  使用mixer实现的遥测功能，该方案已过时，但目前tke-mesh基于istio 1.3.x实现，还在使用。

* 1.3-mixer-telemetry-optimized

  对mixer遥测上报阻塞问题进行优化，可降低envoy造成的延时。

* 1.5-telemetry-nullvm

  1.5默认的遥测方案（没有使用Wasm，但共享实现遥测的代码）

### 吞吐能力

![QPS maximum][rps-qps-relation]

2vCPU测试下，1.3版本使用mixer实现遥测(1.3-mixer-telemetry)，其最大QPS大约为7000左右；1.5版本使用nullvm的方式(1.5-telemetry-nullvm)则有2000QPS的提升，达到9000左右；
关闭telemtry之后(1.3-no-telemetry)，QPS峰值达到13000左右；tke-mesh阻塞优化版的QPS有所下降，只有6000左右，这是因为将上报任务的数据迁移到异步线程中有所消耗。

QPS达到峰值时的CPU资源已成为瓶颈，实际生产环境中我们并不会让系统在如此搞负载下运行。下文的图表中我们只关注5000QPS以下的数据。

### 延时

P90延时

![P90 Latency][qps-latency-p90]

P99延时
![!P99 Latency][qps-latency-p99]

使用istio之后，较低QPS负载下延时增加不多，随着QPS的增加延时逐步增大。其中，使用mixer实现的遥测对调用延时影响最明显，即使tke-mesh进行一些优化后，在高负载情况(5000)下，P99也明显增加。
istio-1.5使用mixer-less的方案，其延时有明显的改善。

### Envoy cpu 消耗

server-side cpu消耗
![Server Side Envoy CPU Usage][qps-server-side-cpu-usage]

client-side cpu 消耗
![Client Side Envoy CPU Usage][qps-client-side-cpu-usage]

可以看出，遥测功能会增加30%左右的CPU消耗，即使1.5版本引入mixer-less的遥测方案，CPU消耗也只在client侧有一些降低。

### Envoy memory 消耗
server-side memory
![Server Side Envoy Memory Usage][qps-server-side-memory-usage]

client-side memory
![Client Side Envoy Memory Usage][qps-client-side-memory-usage]

Envoy消耗的内存不多，并没有随QPS增加而增加，AsyncWorker方案大约增加了10MB的内存占用，没有太大的影响。

## 后记

ServiceMesh发展至今，性能问题横在面前，阻碍着其大规模应用。 从2019年下开始，我们Istio在性能方面逐步投入了更多的精力进行研究优化，
回头来看，走过的路弯弯折折，虽成果不多，但收获不少经验，希望它可以帮助我们对今后前进的方向提供一些帮助。

最后，再谈一谈对Istio发展缓慢的理解：

* `Service Mesh` 本身有一定的入门门槛。Istio本身架构实现过于复杂，加重了部署推广的难度。

    监控、跟踪、路由、断路保护、负载均衡、访问控制等每一项看似简单，综合起来其实是个复杂的系统，初学者使用门槛较高。
    (不少开发者介绍Istio时比较欣赏其优美的架构，但优美是主观的。我们运行起istio各种组件，看着它们协调在一起工作时，可能会产生一种系统完备且充满控制感的优美错觉，但它遮住了复杂性和性能不足的问题，从这个角度讲它是残缺的。优雅解决ServiceMesh关键问题的架构是不是更美呢？)

* `Service Mesh`架构面对的问题域对性能十分敏感，其核心功能需要侵入业务网络流量进行分析、导流，然而Istio社区对性能的重视程度较低，导致使用者顾虑较多。

    Istio各版本中对性能的一些优化措施没有太好的效果，属于填初期设计的坑：Mixer Cache降低Check对Server的压力，但在实际中可能并有什么效果；遥测上报数据进行delta-Encoding和Compress优化操作，以降低遥测功能产生的网络流量，带来复杂性的同时又消耗掉可观的CPU；如今推倒重来用Wasm在proxy中实现原来mixer的功能，去掉了mixer-server组件能节约一大笔资源，但数据面性能优化却不是主要目标，其性能并没有质的改变，反而随着Wasm引入而带来的灵活性，大家的目光反而被可扩展性引开。

    再看看Kubernetes的做法：作为编排工具，Kubernetes大部分功能是运维管理性的，不会直接对业务造成明显的性能损害，其对性能最敏感的Runtime和Network部份则全部用插件实现，CNI简化到只剩标准接口，社区和企业可以自由地进行实现。
    **Istio**不一样，基于Envoy实现的sidecar跟控制面有较强的耦合，利用xDS标准单独实现一个代理也仅仅存在于理论之中（udpa很有漫长的路要走），复杂度和没有统一的标准都是实现自定义代理拦路虎，暂不具备可操作性。
    而Istio在性能上的缓慢改进的表现，不知道又会损害多少工程师对它的信心，进一步影响发展速度。

[istio-proxy]: http://github.com/istio/proxy
[data-plane-diagram]: data-plane-diagram.png
[istio-structure]: istio-structure.png
[hdr-oc-problem]: https://bravenewgeek.com/wp-content/uploads/2016/02/coordinated_omission.png
[oc-problem-graph]: oc-problem-in-queue-system.svg
[test-env]: test-env.svg
[golang-json-patch]: https://github.com/evanphx/json-patch
[envoy-record-time]: envoy-record-time.svg
[envoy-latency-distribution]: envoy-latency-distribution.png
[istio-mixer-attribute-building]: istio-mixer-attribute-building.png
[istio-mixer-attribute-batch-compress]:istio-mixer-attribute-batch-compress.png
[rps-qps-relation]: rps-qps-relation.png
[qps-latency-p90]: qps-latency-p90.png
[qps-latency-p99]: qps-latency-p99.png
[qps-server-side-cpu-usage]: qps-server-side-cpu-usage.png
[qps-server-side-memory-usage]: qps-server-side-memory-usage.png
[qps-client-side-cpu-usage]: qps-client-side-cpu-usage.png
[qps-client-side-memory-usage]:qps-client-side-memory-usage.png
[envoy-worker-structure]: envoy-worker-structure.png
[async-worker-report]: async-worker-report.svg
[envoy-latency-optimized-distribution]: envoy-latency-optimized-distribution.png
[e2e-latency-optimized-compare]: e2e-latency-optimized-compare.png

